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

Use a `pre` version if you're testing.

# How it works

Warning: requires `npm@>=3` to install the generated packages globally!

This package generates a `node` package, and all of the `node-{os}-{cpu}` packages, which are installed by the main metapackage (and as a hack, added to the `package.json` of `node` at install time as a dependency to keep npm from marking it extraneous..

# License

ISC
