from models.cell import Cell
from models.grid import Grid


def generate_grid(n_rows, n_columns, origin, width):
    cell_size = width / n_columns
    height = cell_size * n_rows

    x_bottom_left = origin[0] - width / 2
    y_bottom_left = origin[1] - height / 2

    xs = n_rows * [x_bottom_left + (i + 0.5) * cell_size for i in range(n_columns)]
    ys = sorted(n_columns * [y_bottom_left + (i + 0.5) * cell_size for i in range(n_rows)])
    centers = zip(xs, ys)

    cells = [Cell(center, cell_size) for center in centers]
    return Grid(cells, cell_size, n_rows, n_columns, x_bottom_left, y_bottom_left)
