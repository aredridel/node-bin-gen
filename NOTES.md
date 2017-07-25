Get all versions of node:

```curl https://nodejs.org/download/release/index.json | json -a version | sed -e 's/v//' | sort -V > versions```
