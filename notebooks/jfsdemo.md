---
meta:
  - title: "JFS Coding Env"
  - author: "h3ssto"
  - version: "v0.1"
dependencies:
  - matplotlib
  - numpy
---

# Sortieren von Listen

Am Dienstag hatten wir mit Hilfe von ChatGPT bereits Python-Code zum Sortieren von Listen erstellt.

## Bubblesort

Der [Bubblesort](https://de.wikipedia.org/wiki/Bubblesort) durchläuft die Liste an Zahlen von links nach rechts. Verstoßen zwei benachbarte Zahlen (an den Positionen `j` und `j+1`) gegen die Sortiervorschrift (`<=`), so werden diese getauscht. Somit ist nach dem ersten Durchlauf die größte Zahl der Liste an der letzten Position und muss für die weitere Sortierung nicht weiter berücksichtigt werden.

```python
def bubble_sort(numbers):
    n = len(numbers)
    for i in range(n):

        # Letzten i Elemente sind bereits an der richtigen Position, am Anfang 0, dann 1, ...
        for j in range(0, n - i - 1):
            if numbers[j] > numbers[j + 1]:

                # Tausche Elemente, wenn sie in der falschen Reihenfolge sind
                numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]

                # Gebe den Zwischenstand aus
                print(numbers)

    return numbers

# Beispiel-Liste
numbers = [7, 2, 9, 4, 1, 5]

print("Initial List:", numbers)

# Sortieren
sorted_numbers = bubble_sort(numbers)

print("Sorted List:", sorted_numbers)
```

## Selectionsort

Der [Selectionsort](https://de.wikipedia.org/wiki/Selectionsort) durchläuft die Liste von links nach rechts mit dem Laufindex `i`. Für jedes `i` werden alle Werte rechts von `i`, (z.B., `i+1`, `i+2`, ...) durchlaufen und deren Minimum bestimmt. Dieses an `min_index` befindliche Minimum wird dann mit `i` getauscht. 

```python
def selection_sort(numbers):
    n = len(numbers)

    for i in range(n):
        # Wir gehen davon aus, dass das kleinste Element an Position i ist
        min_index = i

        # Suche nach dem kleinsten Element im Rest der Liste
        for j in range(i + 1, n):
            if numbers[j] < numbers[min_index]:
                min_index = j  # Neuer kleinster Wert gefunden

        # Tausche das gefundene Minimum mit dem Element an Position i
        numbers[i], numbers[min_index] = numbers[min_index], numbers[i]

        print(numbers)

    return numbers

# Beispiel-Liste
numbers = [7, 2, 9, 4, 1, 5]

print("Initial List:", numbers)

# Sortieren
sorted_numbers = selection_sort(numbers)

# Ausgabe
print("Sorted List:", sorted_numbers)

```

# Zeichnen mit Python

Unter Verwendung der Bibliothek `matplotlib`, kann man (mit ein bisschen Hilfe von ChatGPT ;-)) ganz einfach zeichnen. Hier z.B. einen Kreis und ein gefülltes Herz.

```python
import matplotlib.pyplot as plt
import numpy as np

# Kreisparameter
radius = 1
center = (0, 0)

# Werte für den Kreis berechnen
theta = np.linspace(0, 2 * np.pi, 100)
x = center[0] + radius * np.cos(theta)
y = center[1] + radius * np.sin(theta)

# Parameter t von 0 bis 2π
t = np.linspace(0, 2 * np.pi, 1000)

# Herz-Kurve mit Parametergleichung
x2 = 16 * np.sin(t)**3
y2 = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)

x2 /= 18
y2 /= 18

# Kreis und Herz plotten
plt.figure()
plt.plot(x, y, label = "Kreis (r = 1)")
plt.fill(x2, y2, color = "red", label = "Herz")
plt.gca().set_aspect('equal', adjustable='box')
plt.title("Kreis und Herz")
plt.grid(True)
plt.legend(loc = "center left", bbox_to_anchor = (1,0.5))
plt.tight_layout()
plt.show()
```