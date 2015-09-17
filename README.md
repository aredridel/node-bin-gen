# node-bin-gen

Generate a node binary package

# Install

```bash
$ npm install -g node-bin-gen
```

# Use

```bash
$ node-bin-gen {node,iojs} version [pre]
```

Use a `pre` version if you're testing.

# How it works

Warning: requires `npm@>=3`!

This package generates a `node-bin` or `iojs-bin` package, and all of the `node-{os}-{cpu}` packages, which are optionally depended on by the main metapackage.

With `npm` version 3, since the tree is maximally flattened, the sub-dependency of the generated packages has a bin property with `node` (and, for io.js, `iojs`) in it. Since each of the sub-dependencies is optional, and they are all marked with mutually exclusive `os` and `cpu` properties, only one will be installed.

This will break if your package depends on something that depends on one of the architecture-specific packages and is not a compatible version with this package's dependencies: they will be nested too deeply and not be found in your package's `node_modules/.bin` directory. Don't do that.

At some point verification may be added to the `install` script that at least one package installed, and in the correct location. At the moment the generated packages assume that works. YMMV.

# License

ISC
