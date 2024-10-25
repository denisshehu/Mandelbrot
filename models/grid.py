import os.path
import time

import joblib
from matplotlib import pyplot as plt
from matplotlib.collections import PolyCollection

from models.cell import Cell


class Grid:

    def __init__(self, n_rows, n_columns, origin, width, max_n_iterations, radius, colormap):
        self._n_rows = n_rows
        self._n_columns = n_columns

        self._cell_size = width / n_columns
        self._x_bottom_left = origin[0] - width / 2
        height = self._cell_size * n_rows
        self._y_bottom_left = origin[1] - height / 2

        self._cells = self._create_cells(max_n_iterations, radius, colormap)

    def _create_cell(self, center, max_n_iterations, radius, colormap):
        return Cell(center, self._cell_size, max_n_iterations, radius, colormap)

    def _create_cells(self, max_n_iterations, radius, colormap):
        xs = self._n_rows * [self._x_bottom_left + (i + 0.5) * self._cell_size for i in range(self._n_columns)]
        ys = sorted(self._n_columns * [self._y_bottom_left + (i + 0.5) * self._cell_size for i in range(self._n_rows)])
        centers = zip(xs, ys)

        start_time = time.time()
        print('Creating cells...', end='', flush=True)

        cells = joblib.Parallel(n_jobs=-1)(
            joblib.delayed(self._create_cell)(center, max_n_iterations, radius, colormap) for center in centers
        )

        elapsed_time = time.time() - start_time
        print(f'\rCells created. ({elapsed_time:.2f} seconds)')

        return cells

    def draw(self, filename):
        correction = 1.299
        width = 1920
        height = 1080
        dpi = 100

        plt.figure(figsize=(correction * width / dpi, correction * height / dpi), dpi=dpi)
        plt.gca().set_aspect('equal')

        start_time = time.time()
        print('Generating image...', end='', flush=True)

        corners = list()
        colors = list()
        for cell in self._cells:
            xs, ys = cell.get_corners()
            corners.append(list(zip(xs, ys)))
            colors.append(cell.color)

        plt.gca().add_collection(PolyCollection(corners, color=colors, edgecolors=None))

        elapsed_time = time.time() - start_time
        print(f'\rImage generated. ({elapsed_time:.2f} seconds)')

        x_max = self._x_bottom_left + self._cell_size * self._n_columns
        plt.xlim(self._x_bottom_left, x_max)

        y_max = self._y_bottom_left + self._cell_size * self._n_rows
        plt.ylim(self._y_bottom_left, y_max)

        plt.xticks(list())
        plt.yticks(list())

        for spine in plt.gca().spines.values():
            spine.set_visible(False)

        images_directory_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'images')
        file_path = os.path.join(images_directory_path, f'{filename}.png')

        start_time = time.time()
        print('Saving image...', end='', flush=True)

        plt.savefig(file_path, bbox_inches='tight', pad_inches=0)

        elapsed_time = time.time() - start_time
        print(f'\rImage saved. ({elapsed_time:.2f} seconds)')

        plt.close()
