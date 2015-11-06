node-bin
========

Mad science ahead

Installs a `node` binary into your project, which because `npm` runs scripts with the local `./node_modules/.bin` in the `PATH` ahead of the system copy means you can have a local verion of node that is different than your system's, and manage node as a normal dependency.

Warning: don't install this globally with npm 2. `npm@2` immediately removes node, then can't run the scripts that make this work. It is mad science after all.

Use
-----

`npm install --save node-bin@v4-lts`

or with npm 3:

`npm install -g node-bin@v4-lts`
