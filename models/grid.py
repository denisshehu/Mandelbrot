import os.path

from matplotlib import pyplot as plt


class Grid:

    def __init__(self, cells, cell_size, n_rows, n_columns, x_bottom_left, y_bottom_left):
        self._cells = cells
        self._cell_size = cell_size
        self._n_rows = n_rows
        self._n_columns = n_columns
        self._x_bottom_left = x_bottom_left
        self._y_bottom_left = y_bottom_left

    def draw(self, filename):
        correction = 1.299
        width = 1920
        height = 1080
        dpi = 100

        plt.figure(figsize=(correction * width / dpi, correction * height / dpi), dpi=dpi)
        plt.gca().set_aspect('equal')

        for cell in self._cells:
            xs, ys = cell.get_corners()
            plt.fill(xs, ys, c=cell.color)

        x_max = self._x_bottom_left + self._cell_size * self._n_columns
        plt.xlim(self._x_bottom_left, x_max)

        y_max = self._y_bottom_left + self._cell_size * self._n_rows
        plt.ylim(self._y_bottom_left, y_max)

        plt.xticks(list())
        plt.yticks(list())

        plt.gca().spines['top'].set_visible(False)
        plt.gca().spines['right'].set_visible(False)
        plt.gca().spines['bottom'].set_visible(False)
        plt.gca().spines['left'].set_visible(False)

        desktop_path = os.path.join(os.environ['USERPROFILE'], 'Desktop')
        file_path = os.path.join(desktop_path, filename)
        plt.savefig(f'{file_path}.png', bbox_inches='tight', pad_inches=0)
        plt.savefig(f'{file_path}.pdf', bbox_inches='tight', pad_inches=0)
