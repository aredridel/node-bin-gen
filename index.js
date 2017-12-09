#!/usr/bin/env node
"use strict"

const fs = require('fs')
const path = require('path')
const os = require('os')
const util = require('util')
const execFile = util.promisify(require('child_process').execFile)
const unlink = util.promisify(fs.unlink)
const mkdir = util.promisify(fs.mkdir)
const writeFile = util.promisify(fs.writeFile)
const readFile = util.promisify(fs.readFile)

const fetch = require('make-fetch-happen').defaults({
  cacheManager: path.resolve(os.homedir(), '.node-bin-gen-cache')
})

const VError = require('verror')
const rimraf = util.promisify(require('rimraf'))
const zlib = require('zlib')
const { spawn } = require('child_process')
const yargs = require('yargs')
const pump = util.promisify(require('pump'))
const debug = require('util').debuglog('node-bin-gen')
const eos = util.promisify(require('end-of-stream'))

yargs.option('skip-binaries', { describe: 'Skip downloading the binaries', boolean: true })
yargs.option('only', { describe: 'Only download this binary package' })
yargs.option('package-name', { alias: 'n', describe: 'Use this as the main package name', default: 'node-bin' })
yargs.version()
yargs.demandCommand(1, 2, 'You must specify version, and optionally a prerelease')
yargs.help('help').wrap(76)

const argv = yargs.argv

const versionprime = argv._[0]
const pre = argv._[1]

if (!versionprime) {
  console.warn("Use: " + argv.$0 + " version [pre]")
  process.exit(1)
  return
}

const version = (versionprime[0] != 'v') ? 'v' + versionprime : version

async function buildArchPackage(os, cpu, version, pre) {
  debug("building architecture specific package", os, cpu, version, pre)

  const platform = os == 'win' ? 'win32' : os
  const arch = os == 'win' && cpu == 'ia32' ? 'x86' : cpu
  const executable = os == 'win' ? 'bin/node.exe' : 'bin/node'

  const dir = "node-" + os + '-' + cpu
  const base = "node-" + version + "-" + os + "-" + cpu
  const filename = base + (os == 'win' ? '.zip' : ".tar.gz")
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
  }

  debug('removing', dir)
  await rimraf(dir, { glob: false })
  await mkdir(dir).catch(e => {
      if (e.code != 'EEXIST') throw e
    })

  const url = "https://nodejs.org" + (
    /rc/.test(version) ? "/download/rc/" :
    /test/.test(version) ? "/download/test/" :
    "/dist/"
  ) + version + "/" + filename

  debug("Fetching", url)

  const res = await fetch(url)

  if (res.status != 200 && res.status != 304) {
    throw new VError("not ok: fetching %j got status code %s", url, res.status)
  }

  debug("Unpacking into", dir)

  if (os == 'win') {
    const f = fs.createWriteStream(filename)
    const written = pump(res.body, f)
    const closed = eos(f)

    await Promise.all([written, closed])
    await execFile('unzip', ['-d', `${dir}/bin`, '-o', '-j', filename, `${base}/node.exe` ])
    await unlink(filename)
  } else {
    const c = spawn('tar', ['--strip-components=1', '-C', dir, '-x'], {
      stdio: [ 'pipe', process.stdout, process.stderr ]
    })
    await pump(res.body, zlib.createGunzip(), c.stdin)
  }

  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  return pkg
}

async function fetchManifest(version) {
  const base = 'http://nodejs.org'
  const url = (function () {
    if (/rc/.test(version)) {
      return `${base}/download/rc/index.json`
    } else if (/test/.test(version)) {
      return `${base}/download/test/index.json`
    } else {
      return `${base}/dist/index.json`
    }
  })()
  const res = await fetch(url)
  return res.json()
}

main().catch(err => {
  console.warn(err.stack)
  process.exit(1)
})

async function main() {

  const manifest = argv['skip-binaries'] ? [] : await fetchManifest(version)

  const v = manifest.filter(function(ver) {
    return ver.version == version
  }).shift()

  if (!v) {
    throw new VError("No such version '%s'", version)
  }
  debug("manifest", v)

  if (!v.files || !v.files.length) {
    debug("No files, defaulting")
    v.files =  ['darwin-x64', 'linux-arm64', 'linux-armv7l', 'linux-ppc64', 'linux-ppc64le', 'linux-s390x', 'linux-x64', 'linux-x86', 'sunos-x64', 'win-x64', 'win-x86']
  }

  const files = argv.only ? [argv.only] : v.files

  const binaries = files.filter(function(f) {
    return !/^headers|^src/.test(f) && !/pkg$/.test(f) && !/^win-...-(exe|msi|7z)/.test(f)
  }).map(function(f) {
    const bits = f.split('-')
    return {
      os: bits[0].replace(/^osx$/, 'darwin'),
      cpu: bits[1],
      format: bits[2] || 'tar.gz'
    }
  })

  await Promise.all(binaries.map(v => buildArchPackage(v.os, v.cpu, version, pre)))

  const pkg = buildMetapackage(version + (pre != null ? '-' + pre : ''))

  try {
    await mkdir(pkg.name)
  } catch(err) {
    if (err && err.code != 'EEXIST') {
      throw err
    }
  }

  const script = `require('node-bin-setup')("${pkg.version}", require)`

  await Promise.all([
    readFile(path.resolve(__dirname, 'node-bin-README.md'), 'utf8')
      .then(readme => writeFile(path.resolve(pkg.name, 'README.md'), readme.replace(/\$\{packagename\}/g, pkg.name))),
    writeFile(path.resolve(pkg.name, 'package.json'), JSON.stringify(pkg, null, 2)),
    writeFile(path.resolve(pkg.name, 'installArchSpecificPackage.js'), script)
  ])
}

function buildMetapackage(version) {
  const pkg = {
    "name": argv['package-name'],
    "version": version.replace(/^v/, ''),
    "description": "node",
    "main": "index.js",
    "keywords": [
      "runtime"
    ],
    "repository": require('./package.json').repository,
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
  }

  return pkg
}
