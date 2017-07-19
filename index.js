#!/usr/bin/env node

var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var fetch = require('node-fetch');
var https = require('https');
var path = require('path');
var VError = require('verror');
var tar = require('tar');
var rimraf = P.promisify(require('rimraf'));
var zlib = require('zlib');
var cp = P.promisifyAll(require('child_process'));
var yargs = require('yargs');
var pump = P.promisify(require('pump'));
var debug = require('util').debuglog('node-bin-gen');

yargs.describe('skip-binaries', 'Skip downloading the binaries');
yargs.option('only', { describe: 'Only download this binary package' });
yargs.demand(1, 2, 'You must specify version, and optionally a prerelease');
yargs.help('help').wrap(76);
var argv = yargs.argv;

var version = argv._[0];
var pre = argv._[1];

if (!version) {
  console.warn("Use: " + argv.$0 + " version [pre]");
  process.exit(1);
  return;
}

if (version[0] != 'v') {
  version = 'v' + version;
}

function buildArchPackage(os, cpu, version, pre) {
  debug("building architecture specific package", os, cpu, version, pre);

  var platform = os == 'win' ? 'win32' : os;
  var arch = os == 'win' && cpu == 'ia32' ? 'x86' : cpu;
  var executable = os == 'win' ? 'bin/node.exe' : 'bin/node';

  var dir = "node-" + os + '-' + cpu;
  var base = "node-" + version + "-" + os + "-" + cpu;
  var filename = base + (os == 'win' ? '.zip' : ".tar.gz");
  var pkg = {
    name: 'node' + "-" + os + "-" + cpu,
    version: version + (pre != null ? '-' + pre : ''),
    description: 'node',
    bin: {
      node: os == 'win' ? 'bin/node.exe' : "bin/node"
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
    var url = "https://nodejs.org" + (
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

(argv['skip-binaries'] ? P.resolve([]) : fetchManifest(version).then(function(manifest) {

  var v = manifest.filter(function(ver) {
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
    var bits = f.split('-');
    return {
      os: bits[0].replace(/^osx$/, 'darwin'),
      cpu: bits[1],
      format: bits[2] || 'tar.gz'
    };
  });
}).map(function(v) {
  return buildArchPackage(v.os, v.cpu, version, pre);
})).then(buildMetapackage(version + (pre != null ? '-' + pre : ''))).then(function(pkg) {
  return fs.mkdirAsync(pkg.name).catch(function(err) {
    if (err && err.code != 'EEXIST') {
      throw err;
    }
  }).then(function() {

    const script = `require('node-bin-setup')("${pkg.version}", require);`;

    return P.all([
      fs.readFileAsync(path.resolve(__dirname, 'node-bin-README.md')).then(function(readme) {
        return fs.writeFileAsync(path.resolve(pkg.name, 'README.md'), readme)
      }),
      fs.writeFileAsync(path.resolve(pkg.name, 'package.json'), JSON.stringify(pkg, null, 2)),
      fs.writeFileAsync(path.resolve(pkg.name, 'installArchSpecificPackage.js'), script)
    ]);
  });
}).catch(function(err) {
  console.warn(err.stack);
  process.exit(1);
});

function buildMetapackage(version) {
  return function(packages) {
    versionN = version.replace(/^v/, '');
    var pkg = {
      "name": "node-bin",
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
