---
meta:
  - title: "Unified Variability Language"
  - author: "h3ssto"
  - version: "v0.1"
dependencies:
  - uvllang
---

# UVL
The [Universal Variability Language (UVL)](https://universal-variability-language.github.io/) is a textual format for feature models, created to address the divergence of formats and tooling in the software product line community. It defines a common syntax for features, their hierarchy, and cross-tree constraints. UVL is organized into language levels: a Boolean core covering standard feature model semantics, and optional extensions (arithmetic, feature cardinalities, types, string constraints) that tools can support incrementally without requiring full compliance. 

The following demo showcases UVL -> DIMACS using [uvllang](https://github.com/obddimal/uvllang).

---
filename: "example.uvl"
---
```UVL
features
  Root
    mandatory
      Child1
        or
          Child1_1
          Child1_2
      Child2
    optional
      OptionalChild

constraints
  Child1_2 => OptionalChild
```

Running the cell below parses `example.uvl` and writes the resulting DIMACS CNF to `example.dimacs`. That file is shown afterwards and updates in place whenever the cell runs.

```python
from uvllang import UVL

model = UVL(from_file = "example.uvl")
model.to_dimacs("example.dimacs")
```

---
filename: "example.dimacs"
read-only: True
---
```dimacs
Run the cell above to generate this file.
```
