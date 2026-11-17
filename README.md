# node-bin-gen

Generate a node binary package

# Install

```bash
$ npm install -g node-bin-gen
```

# Use

```bash
$ node-bin-gen version [pre]
```

`version` is the Node.js release to package, for example `22.11.0` (a leading `v` is optional).

`pre` is an optional prerelease tag. It is appended to the generated package version (for example `node-bin-gen 22.11.0 test1` produces version `22.11.0-test1`), which is useful when you're testing a build before publishing it for real.

## Options

| Option | Description |
| --- | --- |
| `--package-name`, `-n` | Name of the main package (default: `node`) |
| `--skip-binaries` | Skip downloading the binaries |
| `--only <package>` | Only download this binary package |
| `--verbose` | Output progress messages |
| `--help` | Show help |

# How it works

Warning: requires `npm@>=3` to install the generated packages globally!

This package generates a `node` package and all of the `node-{os}-{cpu}` packages. The platform packages are installed by the main metapackage, and, as a hack, added to the `package.json` of `node` at install time as a dependency to keep npm from marking them extraneous.

# Known limitations

Because the right binary is chosen and installed by install scripts, some package managers and commands don't work well with the generated packages:

- **Yarn 3+ (Berry):** installing fails because of how Yarn now orders lifecycle scripts. See [#139](https://github.com/aredridel/node-bin-gen/issues/139).
- **`npm ci`:** may not install the node binary. See [#88](https://github.com/aredridel/node-bin-gen/issues/88).
- **`npm install -g node`:** can remove the node binary npm is running on. See [#74](https://github.com/aredridel/node-bin-gen/issues/74).
- **`npm rebuild`:** can fail because node can't unlink itself while running. See [#63](https://github.com/aredridel/node-bin-gen/issues/63).
- **Git Bash on Windows:** the `node_modules/.bin/node` shim may resolve the wrong path. See [#62](https://github.com/aredridel/node-bin-gen/issues/62).

# License

ISC
