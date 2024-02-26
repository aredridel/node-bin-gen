#!/usr/bin/env node
"use strict";

import { open, unlink, mkdir, writeFile, readFile } from "node:fs/promises";
import { Writable, Transform } from "node:stream";
import { join, resolve, dirname } from "node:path";
import { debuglog, promisify } from "node:util";
import { execFile as execFile_, spawn } from "node:child_process";
import { fileURLToPath } from "url";

import verr from "verror";
import {rimraf} from "rimraf";
import zlib from "zlib";
import yargs from "yargs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execFile = promisify(execFile_);

const { VError } = verr;

const argparser = yargs(process.argv.slice(2));
argparser.option("skip-binaries", {
  describe: "Skip downloading the binaries",
  boolean: true,
});
argparser.option("only", { describe: "Only download this binary package" });
argparser.option("package-name", {
  alias: "n",
  describe: "Use this as the main package name",
  default: "node",
});
argparser.option("verbose", { describe: "output messages", boolean: true });
argparser.version();
argparser.demandCommand(
  1,
  2,
  "You must specify version, and optionally a prerelease"
);
argparser.help("help").wrap(76);

const argv = argparser.argv;

const versionprime = argv._[0];
const pre = argv._[1];

if (!versionprime) {
  console.warn("Use: " + argv.$0 + " version [pre]");
  process.exit(1);
}

const ndebug = debuglog("node-bin-gen");
function debug(...args) {
  if (argv.verbose) {
    console.warn(...args);
  }
  ndebug(...args);
}

const version = versionprime[0] != "v" ? "v" + versionprime : versionprime;

async function buildArchPackage(os, cpu, version, pre) {
  debug("building architecture specific package", os, cpu, version, pre);

  const platform = os == "win" ? "win32" : os;
  const arch = os == "win" && cpu == "ia32" ? "x86" : cpu;
  const executable = os == "win" ? "bin/node.exe" : "bin/node";

  const dir = "node-" + os + "-" + cpu;
  const base = "node-" + version + "-" + os + "-" + cpu;
  const filename = base + (os == "win" ? ".zip" : ".tar.gz");
  const pkg = {
    name:
      (os == "darwin" && cpu == "arm64" ? "node-bin" : "node") +
      "-" +
      os +
      "-" +
      cpu,
    version: version + (pre != null ? "-" + pre : ""),
    description: "node",
    bin: {
      node: executable,
    },
    files: [
      os == "win" ? "bin/node.exe" : "bin/node",
      "share",
      "include",
      "*.md",
      "LICENSE",
    ],
    os: platform,
    cpu: arch == 'ppc64le' ? 'ppc64' : arch,
  };

  debug("removing", dir);
  await rimraf(dir, { glob: false });
  debug("creating", dir);
  await mkdir(dir).catch((e) => {
    if (e.code != "EEXIST") throw e;
  });

  const url =
    "https://nodejs.org" +
    (/rc/.test(version)
      ? "/download/rc/"
      : /test/.test(version)
      ? "/download/test/"
      : "/dist/") +
    version +
    "/" +
    filename;

  debug("Fetching", url);

  const res = await fetch(url);

  if (res.status != 200 && res.status != 304) {
    throw new VError("not ok: fetching %j got status code %s", url, res.status);
  }

  debug("Unpacking into", dir);

  if (os == "win") {
    const f = await open(filename, "w");

    await res.body.pipeTo(Writable.toWeb(f.createWriteStream()));

    const running = await execFile("unzip", [
      "-d",
      `${dir}/bin`,
      "-o",
      "-j",
      filename,
      `${base}/node.exe`,
    ]);

    if (running.stderr) console.warn("error from unzip", running.stderr);

    await unlink(filename);
  } else {
    const c = spawn("tar", ["--strip-components=1", "-C", dir, "-x"], {
      stdio: ["pipe", process.stdout, process.stderr],
    });

    const unzip = Transform.toWeb(zlib.createGunzip());

    await res.body.pipeThrough(unzip).pipeTo(Writable.toWeb(c.stdin));
  }

  debug("Finished unpacking into", dir);

  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  return pkg;
}

async function fetchManifest(version) {
  const base = "http://nodejs.org";
  const url = (function () {
    if (/rc/.test(version)) {
      return `${base}/download/rc/index.json`;
    } else if (/test/.test(version)) {
      return `${base}/download/test/index.json`;
    } else {
      return `${base}/dist/index.json`;
    }
  })();
  const res = await fetch(url);
  return res.json();
}

main().catch((err) => {
  console.warn(err);
  process.exit(1);
});

async function main() {
  const manifest = argv["skip-binaries"] ? [] : await fetchManifest(version);

  const v = manifest
    .filter(function (ver) {
      return ver.version == version;
    })
    .shift();

  if (!v) {
    throw new VError("No such version '%s'", version);
  }
  debug("manifest", v);

  if (!v.files || !v.files.length) {
    debug("No files, defaulting");
    v.files = [
      "darwin-x64",
      "darwin-arm64",
      "linux-arm64",
      "linux-armv7l",
      "linux-ppc64",
      "linux-ppc64le",
      "linux-s390x",
      "linux-x64",
      "linux-x86",
      "sunos-x64",
      "win-arm64",
      "win-x64",
      "win-x86",
    ];
  }

  const files = argv.only ? [argv.only] : v.files;

  const binaries = files
    .filter(function (f) {
      return (
        !/^headers|^src/.test(f) &&
        !/pkg$/.test(f) &&
        !/^win-([^-]+)-(exe|msi|7z)/.test(f)
      );
    })
    .map(function (f) {
      const bits = f.split("-");
      return {
        os: bits[0].replace(/^osx$/, "darwin"),
        cpu: bits[1],
        format: bits[2] || "tar.gz",
      };
    });

  for (const v of binaries) {
    await buildArchPackage(v.os, v.cpu, version, pre)
  }

  const pkg = await buildMetapackage(version + (pre != null ? "-" + pre : ""));

  try {
    await mkdir(pkg.name);
  } catch (err) {
    if (err && err.code != "EEXIST") {
      throw err;
    }
  }

  const script = `require('node-bin-setup')("${pkg.version}", require)`;

  await Promise.all([
    readFile(resolve(__dirname, "node-bin-README.md"), "utf8").then((readme) =>
      writeFile(
        resolve(pkg.name, "README.md"),
        readme.replace(/\$\{packagename\}/g, pkg.name)
      )
    ),
    writeFile(resolve(pkg.name, "package.json"), JSON.stringify(pkg, null, 2)),
    writeFile(resolve(pkg.name, "installArchSpecificPackage.js"), script),
  ]);
}

async function buildMetapackage(version) {
  const pkg = {
    name: argv["package-name"],
    version: version.replace(/^v/, ""),
    description: "node",
    main: "index.js",
    keywords: ["runtime"],
    repository: JSON.parse(await readFile(`${__dirname}/package.json`))
      .repository,
    scripts: {
      preinstall: "node installArchSpecificPackage",
    },
    bin: {
      node: "bin/node",
    },
    dependencies: {
      "node-bin-setup": "^1.0.0",
    },
    license: "ISC",
    author: "",
    engines: {
      npm: ">=5.0.0",
    },
  };

  return pkg;
}
