import winsound

from models.colormap import Colormap
from models.grid import Grid

n_rows = 1080
n_columns = 1920
origin = (-0.75, 0)
width = 4.2
# origin = (0.16125, 0.638438)
# width = 0.05
max_n_iterations = 1000
radius = 2 ** 8
colormap = Colormap.DEFAULT.value
filename = 'Default'

grid = Grid(n_rows, n_columns, origin, width, max_n_iterations, radius, colormap)
grid.draw(f'{filename} ({n_columns}x{n_rows})')

winsound.Beep(500, 3000)
