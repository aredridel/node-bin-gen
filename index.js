#!/usr/bin/env node

var fs = require('fs');
var https = require('https');
var path = require('path');

var p = parse(process.argv[2]);
var version = process.argv[3];

if (!p.platform || !p.arch || !version || !p.product) {
    console.warn("Use: " + process.argv[0] + " " + process.argv[1] + " {node,iojs}-{platform}-{arch} version");
    process.exit(1);
    return;
}


function go(platform, arch, version, product, cb) {
    var dir = product + "-" + platform + '-' + arch;
    var base = product + "-v" + version + "-" + platform + "-" + arch;
    var filename = base + ".tar.gz";
    var package = {
        name: product + "-" + platform + "-" + arch,
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
        repository: {
            type: "git",
            url: "https://github.com/aredridel/" + product + "-bin"
        }
    };

    if (product == "iojs") {
        package.bin.iojs = path.join(base, "bin/iojs");
    }

    fs.mkdir(dir, function (err) {
        if (err && err.code != 'EEXIST') {
            return cb(err);
        }
        var req = https.get({hostname: (product == "iojs" ? "iojs.org" : "nodejs.org"), path: (/rc/.test(version) ? "/download/rc/v" : "/dist/v") + version + "/" + filename});
        req.on('error', cb);
        req.on('response', function (res) {
            if (res.statusCode != 200) return cb("not ok: " + res.statusCode);

            res.pipe(fs.createWriteStream(path.join(dir, filename))).on('error', function (err) {
                return cb(err);
            }).on('finish', function () {
                fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(package), function (err) {
                    return cb(err);
                });
            });
        });
    });
}

go(p.platform, p.arch, version, p.product, function (err) {
    if (err) {
        console.warn(err);
        process.exit(1);
    }
});

function parse(str) {
    var out = {};
    var parts = (str || '').split('-');
    out.product = parts[0];
    out.platform = parts[1];
    out.arch = parts[2];
    return out;
}
