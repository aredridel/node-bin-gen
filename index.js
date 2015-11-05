#!/usr/bin/env node

var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var request = P.promisify(require('request'));
var https = require('https');
var path = require('path');
var VError = require('verror');
var tar = require('tar');
var rimraf = P.promisify(require('rimraf'));
var zlib = require('zlib');
var cp = require('child_process');
var yargs = require('yargs');

yargs.describe('skip-binaries', 'Skip downloading the binaries');
yargs.demand(2, 3, 'You must specify node or iojs, version, and optionally a prerelease');
yargs.help('help').wrap(76);
var argv = yargs.argv;

var product = argv._[0];
var version = argv._[1];
var pre = argv._[2];


if (!version || !product) {
  console.warn("Use: " + argv.$0 + " {node,iojs} version [pre]");
  process.exit(1);
  return;
}

if (version[0] != 'v') {
    version = 'v' + version;
}

function buildArchPackage(os, cpu, version, product, pre) {
  var dir = product + "-" + os + '-' + cpu;
  var base = product + "-" + version + "-" + os + "-" + cpu;
  var filename = base + ".tar.gz";
  var pkg = {
    name: product + "-" + os + "-" + cpu,
    version: version + (pre != null ? '-' + pre : ''),
    description: product,
    bin: {
      node: "bin/" + product
    },
    files: [
      'bin/node',
      'share',
      'include',
      '*.md',
      'LICENSE'
    ],
    os: os,
    cpu: cpu,
    repository: {
      type: "git",
      url: "https://github.com/aredridel/" + product + "-bin.git"
    },
    homepage: "https://github.com/aredridel/" + product + "-bin"
  };

  if (product == "iojs") {
    pkg.files.unshift('bin/iojs');
    pkg.bin.iojs = "bin/iojs";
  }

  return rimraf(dir).then(function() {
    return fs.mkdirAsync(dir);
  }).catch(function(err) {
    if (err && err.code != 'EEXIST') {
      throw err;
    }
  }).then(function downloadBinaries() {
    return new P(function(accept, reject) {
      var spec = {
        hostname: (product == "iojs" ? "iojs.org" : "nodejs.org"),
        path: (/rc/.test(version) ? "/download/rc/" : "/dist/") + version + "/" + filename
      }
      var req = https.get(spec);
      req.on('error', reject);
      req.on('response', function(res) {
        if (res.statusCode != 200) return reject(new VError("not ok: fetching %j got status code %s", spec, res.statusCode));

        var c = cp.spawn('tar', ['--strip-components=1', '-C', dir, '-x']);
        res.pipe(zlib.createGunzip()).pipe(c.stdin).on('error', reject);;
        c.stdout.on('finish', accept);
        c.stderr.pipe(process.stderr);
      });
    });
  }).then(function() {
    return fs.writeFileAsync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2)).then(function() {
      return pkg;
    });
  });
}

function fetchManifest(product) {
  return P.try(function() {
    if (product == 'iojs') {
      return {
        url: 'http://iojs.org/dist/index.json'
      };
    } else if (product == 'node') {
      return {
        url: 'http://nodejs.org/dist/index.json'
      };
    } else {
      throw new VError("unknown product '%s'", product);
    }
  }).then(request).then(getBody).then(JSON.parse);
}

function getBody(rr) {
  return rr[0].body;
}

(argv['skip-binaries'] ? P.resolve([]) : fetchManifest(product).then(function(manifest) {
  var v = manifest.filter(function(ver) {
    return ver.version == version;
  }).shift();
  if (!v) {
    throw new VError("No such version '%s'", version);
  }

  return v.files.filter(function(f) {
    return !/^headers|^win|^src/.test(f);
  }).map(function(f) {
    var bits = f.split('-');
    return {
      os: bits[0].replace(/^osx$/, 'darwin'),
      cpu: bits[1],
      format: bits[2] || 'tar.gz'
    };
  });
}).map(function(v) {
  return buildArchPackage(v.os, v.cpu, version, product, pre);
})).then(buildMetapackage(product, version + (pre != null ? '-' + pre : ''))).then(function(pkg) {
  return P.all([
    fs.writeFileAsync(path.resolve(pkg.name, 'package.json'), JSON.stringify(pkg, null, 2)),
    fs.writeFileAsync(path.resolve(pkg.name, 'installArchSpecificPackage.js'), functionAsProgram(installArchSpecificPackage, product, pkg.version))
  ]);
}).catch(function(err) {
  console.warn(err.stack);
  process.exit(1);
});

function buildMetapackage(product, version) {
  return function(packages) {
    versionN = version.replace(/^v/, '');
    var pkg = {
      "name": product + "-bin",
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
      "license": "ISC",
      "repository": {
        "type": "git",
        "url": "git+https://github.com/aredridel/" + product + "-bin.git"
      },
      "author": "",
      "bugs": {
        "url": "https://github.com/aredridel/" + product + "-bin/issues"
      },
      "engines": {
        "npm": ">=3.0.0"
      },
      "homepage": "https://github.com/aredridel/" + product + "-bin#readme"
    };

    return pkg;
  };
}

function installArchSpecificPackage(product, version) {
  var spawn = require('child_process').spawn;
  var path = require('path');
  var fs = require('fs');

  process.env.npm_config_global = 'false';

  var cp = spawn('npm', ['install', '--save-exact', '--save-bundle', [product, process.platform, process.arch].join('-') + '@' + version],  { stdio: 'inherit' });

  cp.on('close', function (code) {
    var bin = path.resolve(path.dirname(require.resolve([product, process.platform, process.arch].join('-') + '/package.json')), 'bin/' + product);

    try {
      fs.mkdirSync(path.resolve(__dirname, 'bin'));
    } catch (e) {
      if (e.code != 'EEXIST') {
        throw e;
      }
    }

    fs.linkSync(bin, path.resolve(__dirname, 'bin', 'node'));

    if (product == 'iojs') {
      fs.linkSync(bin, path.resolve(__dirname, 'bin', 'iojs'));
    }

    process.exit(code);
  });
}

function functionAsProgram(fn) {
  if (!fn.name) throw new Error("Function must be named");
  var args = [].slice.call(arguments, 1);
  return "#!/usr/bin/env node\n\n" + fn.toString() + '\n\n' + fn.name + '.apply(null, ' + JSON.stringify(args) + '.concat(process.argv.slice(2)))\n';
}
