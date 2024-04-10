import winsound

from functions import *

n_rows = 1080
n_columns = 1920
origin = (-0.75, 0)
width = 4.2
filename = f'{n_columns}x{n_rows}'

grid = generate_grid(n_rows, n_columns, origin, width)
grid.draw(filename)

winsound.Beep(500, 3000)
