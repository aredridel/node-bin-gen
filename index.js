#!/usr/bin/env node
"use strict";

const P = require('bluebird');
const fs = P.promisifyAll(require('fs'));
const path = require('path');
const os = require('os');

const fetch = require('make-fetch-happen').defaults({
  cacheManager: path.resolve(os.homedir(), '.node-bin-gen-cache')
});

const VError = require('verror');
const rimraf = P.promisify(require('rimraf'));
const zlib = require('zlib');
const cp = P.promisifyAll(require('child_process'));
const yargs = require('yargs');
const pump = P.promisify(require('pump'));
const debug = require('util').debuglog('node-bin-gen');

yargs.option('skip-binaries', { describe: 'Skip downloading the binaries', boolean: true });
yargs.option('only', { describe: 'Only download this binary package' });
yargs.option('package-name', { alias: 'n', describe: 'Use this as the main package name', default: 'node-bin' })
yargs.version();
yargs.demandCommand(1, 2, 'You must specify version, and optionally a prerelease');
yargs.help('help').wrap(76);

const argv = yargs.argv;

const versionprime = argv._[0];
const pre = argv._[1];

if (!versionprime) {
  console.warn("Use: " + argv.$0 + " version [pre]");
  process.exit(1);
  return;
}

const version = (versionprime[0] != 'v') ? 'v' + versionprime : version;

function buildArchPackage(os, cpu, version, pre) {
  debug("building architecture specific package", os, cpu, version, pre);

  const platform = os == 'win' ? 'win32' : os;
  const arch = os == 'win' && cpu == 'ia32' ? 'x86' : cpu;
  const executable = os == 'win' ? 'bin/node.exe' : 'bin/node';

  const dir = "node-" + os + '-' + cpu;
  const base = "node-" + version + "-" + os + "-" + cpu;
  const filename = base + (os == 'win' ? '.zip' : ".tar.gz");
  const pkg = {
    name: 'node' + "-" + os + "-" + cpu,
    version: version + (pre != null ? '-' + pre : ''),
    description: 'node',
    bin: {
      node: executable
    },
    files: [
      os == 'win' ? 'bin/node.exe' : 'bin/node',
      'share',
      'include',
      '*.md',
      'LICENSE'
    ],
    os: platform,
    cpu: arch
  };

  return P.try(() => debug('removing', dir)).then(() => rimraf(dir, { glob: false })).then(function() {
    return fs.mkdirAsync(dir).catch(e => {
      if (e.code != 'EEXIST') throw e;
    });
  }).then(function downloadBinaries() {
    const url = "https://nodejs.org" + (
      /rc/.test(version) ? "/download/rc/" :
      /test/.test(version) ? "/download/test/" :
      "/dist/"
    ) + version + "/" + filename;

    debug("Fetching", url);
    return fetch(url).then(function(res) {
      if (res.status != 200) {
        throw new VError("not ok: fetching %j got status code %s", url, res.status);
      }

      debug("Unpacking into", dir);
      if (os == 'win') {
        const f = fs.createWriteStream(filename);
        const written = pump(res.body, f);
        return written.then(() => cp.execFileAsync('unzip', ['-d', `${dir}/bin`, '-o', '-j', filename, `${base}/node.exe` ]));
      } else {
        const c = cp.spawn('tar', ['--strip-components=1', '-C', dir, '-x'], {
	  stdio: [ 'pipe', process.stdout, process.stderr ]
	});
        return pump(res.body, zlib.createGunzip(), c.stdin);
      }
    });
  }).then(function() {
    return fs.writeFileAsync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2)).then(function() {
      return pkg;
    });
  });
}

function fetchManifest(version) {
  const base = 'http://nodejs.org';
  return P.try(function() {
    if (/rc/.test(version)) {
      return `${base}/download/rc/index.json`;
    } else if (/test/.test(version)) {
      return `${base}/download/test/index.json`;
    } else {
      return `${base}/dist/index.json`;
    }
  }).then(function(url) {
    return fetch(url);
  }).then(function(res) {
    return res.json();
  })
}

const binariesFetched = (argv['skip-binaries'] ? P.resolve([]) : fetchManifest(version).then(function(manifest) {
  const v = manifest.filter(function(ver) {
    return ver.version == version;
  }).shift();
  if (!v) {
    throw new VError("No such version '%s'", version);
  }
  debug("manifest", v);

  if (!v.files || !v.files.length) {
    debug("No files, defaulting");
    v.files =  ['darwin-x64', 'linux-arm64', 'linux-armv7l', 'linux-ppc64', 'linux-ppc64le', 'linux-s390x', 'linux-x64', 'linux-x86', 'sunos-x64', 'win-x64', 'win-x86'];
  }

  const files = argv.only ? [argv.only] : v.files;

  return files.filter(function(f) {
    return !/^headers|^src/.test(f) && !/pkg$/.test(f);
  }).map(function(f) {
    const bits = f.split('-');
    return {
      os: bits[0].replace(/^osx$/, 'darwin'),
      cpu: bits[1],
      format: bits[2] || 'tar.gz'
    };
  });
}));

const archPackages = binariesFetched.map(function(v) {
  return buildArchPackage(v.os, v.cpu, version, pre);
});

const metapackage = archPackages.then(buildMetapackage(version + (pre != null ? '-' + pre : ''))).then(function(pkg) {
  return fs.mkdirAsync(pkg.name).catch(function(err) {
    if (err && err.code != 'EEXIST') {
      throw err;
    }
  }).then(function() {

    const script = `require('node-bin-setup')("${pkg.version}", require);`;

    return P.all([
      fs.readFileAsync(path.resolve(__dirname, 'node-bin-README.md')).then(function(readme) {
        return fs.writeFileAsync(path.resolve(pkg.name, 'README.md'), readme.replace(/\$\{packagename\}/g, pkg.name))
      }),
      fs.writeFileAsync(path.resolve(pkg.name, 'package.json'), JSON.stringify(pkg, null, 2)),
      fs.writeFileAsync(path.resolve(pkg.name, 'installArchSpecificPackage.js'), script)
    ]);
  });
})

metapackage.catch(function(err) {
  console.warn(err.stack);
  process.exit(1);
});

function buildMetapackage(version) {
  return function() {
    const pkg = {
      "name": argv['package-name'],
      "version": version.replace(/^v/, ''),
      "description": "node",
      "main": "index.js",
      "keywords": [
        "runtime"
      ],
      "scripts": {
        "preinstall": "node installArchSpecificPackage"
      },
      "bin": {
        "node": "bin/node"
      },
      "dependencies": {
	"node-bin-setup": "^1.0.0"
      },
      "license": "ISC",
      "author": "",
      "engines": {
        "npm": ">=5.0.0"
      }
    };

    return pkg;
  };
}
