---
meta:
  - root
  - title: "Welcome!"
  - author: "h3ssto"
  - version: "v0.1"
dependencies:
  - numpy
  - matplotlib
---

# Welcome!

Welcome to variability.dev: Notebooks! As part of the [variability.dev](variability.dev) project, `variability-notebooks` is a collection of interactive explanatory Markdown files that introduce users to basic skills, tools, and frameworks that are useful in the context of feature modeling and feature-model analysis. This is an early alpha version, but let me show you what we already got:

## Python Integration
That's right, you can run Python code in your browser! Let's click on the green triangle to run the following snippet:

```python
print("Hello world!")
print("Welcome to variability.dev - Notebooks!")
```

The world and yourself should have been greeted! If not, your F12 console probably looks like Cologne on New Years Eve - Yikes! If you are confident that this is our fault, do not hesitate to [open an issue](https://github.com/OBDDimal/variability-notebooks/issues). But if it worked, let's continue.

Another neat feature is the integration of non-Python files into the Python snippets. Let's type your name in the following editor:

---
filename: "name.txt"
---
```md
Name: <your name goes here>
```

Did you press the little checkmark after editing to save it? Great! (_although you could revert it back its original content anytime_) Let's run the following Python snippet:

```python
with open("name.txt") as fp:
  print(fp.read())
```

That's right, the text file from above is available to Python! Let's change it and run the snippet again. Alright, enough fun, onto the next feature.

The next snippet does - hopefully - plot a sine wave, let's run it!

```python
import matplotlib.pyplot as plt
import numpy as np

import math


xs = np.arange(-10, 10, 0.1)
ys = [math.sin(x) for x in xs]

print("xs", xs[:10])
print("ys", ys[:10])

plt.plot(xs, ys)
plt.show()

```

So, plotting works as well! So, that is the tour! I hope you liked it, otherwise [open an issue](https://github.com/OBDDimal/variability-notebooks/issues).

While you are creating the issue, you may take a look at the first proper content, the [PySAT Introduction](pysat.md). Of course, when you want to contribute something, pull requests are always welcome!