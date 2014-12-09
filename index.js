#!/usr/bin/env node

var fs = require('fs');
var https = require('https');
var path = require('path');

var platform = process.argv[2];
var arch = process.argv[3];
var version = process.argv[4];

if (!platform || !arch || !version) {
    console.warn("Use: " + process.argv[0] + " " + process.argv[1] + " platform arch version");
    process.exit(1);
    return;
}


function go(platform, arch, version, cb) {
    var dir = 'node-' + platform + '-' + arch;
    var base = "node-v" + version + "-" + platform + "-" + arch;
    var filename = base + ".tar.gz";
    var package = {
        name: "node-" + platform + "-" + arch,
        version: version,
        description: "node",
        scripts: {
            preinstall: "tar xzf " + filename
        },
        bin: {
            node: path.join(base, "bin/node")
        },
        files: [
            filename
        ]
    };
    fs.mkdir(dir, function (err) {
        if (err && err.code != 'EEXIST') {
            return cb(err);
        }
        var req = https.get({hostname: "nodejs.org", path: "/dist/v" + version + "/" + filename});
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

go(platform, arch, version, function (err) {
    if (err) {
        console.warn(err);
        process.exit(1);
    }
});
