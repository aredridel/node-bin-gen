#!/usr/bin/env node

var P = require('bluebird');
var fs = P.promisifyAll(require('fs'));
var https = require('https');
var path = require('path');
var VError = require('verror');

var p = parse(process.argv[2]);
var version = process.argv[3];

if (!p.os || !p.cpu || !version || !p.product) {
    console.warn("Use: " + process.argv[0] + " " + process.argv[1] + " {node,iojs}-{os}-{cpu} version");
    process.exit(1);
    return;
}

function go(os, cpu, version, product) {
    var dir = product + "-" + os + '-' + cpu;
    var base = product + "-v" + version + "-" + os + "-" + cpu;
    var filename = base + ".tar.gz";
    var package = {
        name: product + "-" + os + "-" + cpu,
        version: version,
        description: product,
        scripts: {
            preinstall: "tar xzf " + filename
        },
        bin: {
            node: path.join(base, "bin/node")
        },
        files: [
            filename
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
        package.bin.iojs = path.join(base, "bin/iojs");
    }

    return fs.mkdirAsync(dir).catch(function(err) {
        if (err && err.code != 'EEXIST') {
            throw err;
        }
    }).then(function () {
        return new P(function (accept, reject) {
            var spec = {hostname: (product == "iojs" ? "iojs.org" : "nodejs.org"), path: (/rc/.test(version) ? "/download/rc/v" : "/dist/v") + version + "/" + filename}
            var req = https.get(spec);
            req.on('error', reject);
            req.on('response', function (res) {
                if (res.statusCode != 200) return reject(new VError("not ok: fetching %j got status code %s",  spec, res.statusCode));

                res.pipe(fs.createWriteStream(path.join(dir, filename))).on('error', function (err) {
                    reject(err);
                }).on('finish', function () {
                    accept();
                });
            });
        });
    }).then(function () {
        return fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(package));
    });
}

go(p.os, p.cpu, version, p.product).catch(function (err) {
    console.warn(err);
    process.exit(1);
});

function parse(str) {
    var out = {};
    var parts = (str || '').split('-');
    out.product = parts[0];
    out.os = parts[1];
    out.cpu = parts[2];
    return out;
}
