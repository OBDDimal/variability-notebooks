---
meta:
  - title: "PySAT Introduction"
  - author: "h3ssto"
  - version: "v0.1"
dependencies:
  - python-sat
---

# PySAT Introduction

This is an interactive introduction to SAT solving using PySAT. Typically, SAT solvers take conjunctive normal forms (CNF) that are supplied in the DIMACS format as an input:

---
filename: "sandwich.dimacs"
---
```DIMACS
c 1 Flatbread
c 2 Vegetables
c 3 Cheddar
c 4 Cheese
c 5 Cucumber 
c 6 Salami 
c 7 Full Grain 
c 8 Bread
c 9 Meat
c 10 Sandwich
c 11 Lettuce
c 12 Toast
c 13 Ham
c 14 Slice
c 15 Gouda
c 16 Tomatoes
c 17 Chicken Breast
c 18 Sprinkled
c 19 Cream Cheese 
p cnf 19 27
10 0
2 -5 0
2 -16 0
2 -11 0
4 -15 0
4 -3 0
4 -19 0
8 -7 0
8 -1 0
8 -12 0
7 1 12 -8 0
-7 -1 0
-7 -12 0
-1 -12 0
9 -6 0
9 -13 0
9 -17 0
6 13 17 -9 0
10 -8 0
10 -4 0
10 -9 0
10 -2 0
8 -10 0
15 -18 0
15 -14 0
18 14 -15 0
-18 -14 0
```

In DIMACS, lines starting with `C` are comments. Typically they are used to link variable ids to variable names. The line `p cnf 19 27` is most important. It specifies that the following clauses are in CNF, namely conjunctions of disjunctions, and that there are 19 variables and 27 CNF clauses.

The following lines denote the clauses of the formula and are all terminated by a zero (note that variable ids start at 1). For example, the line `2 -5 0` denotes the clause $(x_2 \lor \neg x_5)$ or $(\textsf{Vegetables} \lor \neg \textsf{Cucumber})$. 

[PySAT ](https://pysathq.github.io/) is a Python framework that wraps many state-of-the-art solvers. The following snippet loads the DIMACS from above, initializes a solver and verifies that the formula is indeed satisfiable (SAT).

```python
from pysat.formula import CNF
from pysat.solvers import Solver

cnf = CNF(from_file = "sandwich.dimacs")

with Solver(bootstrap_with = cnf.clauses) as solver:
  print("SAT?:", solver.solve())

```

However, we should never trust Boolean answers, after all there could be a `return True` at the other end ;-). Therefore, SAT solvers and therefore PySAT will give you proofs for SAT, namely a satisfying instance:

```python
from pysat.formula import CNF
from pysat.solvers import Solver

cnf = CNF(from_file = "sandwich.dimacs")

with Solver(bootstrap_with = cnf.clauses) as solver:
  if solver.solve():
    print("SAT!:", solver.get_model())
```

In the opposite case, when a formula is not satisfiable, solver typically return an unsatisfiable core. For demonstration, try to find a solution in which we assign `False` to $x_{10}$:

```python
from pysat.formula import CNF
from pysat.solvers import Solver

cnf = CNF(from_file = "sandwich.dimacs")

with Solver(bootstrap_with = cnf.clauses) as solver:
  if solver.solve(assumptions = [-10]):
    print("SAT!, model:", solver.get_model())
  else:
    print("UNSAT!, core:", solver.get_core())
```

