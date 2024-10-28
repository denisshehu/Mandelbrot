import os.path
import time

import joblib
from matplotlib import pyplot as plt
from matplotlib.collections import PolyCollection

from models.cell import Cell


class Image:

    def __init__(self, image_width, image_height, cell_size, center, plane_width, max_n_iterations, radius, colormap,
                 filename):
        self._image_width = image_width
        self._image_height = image_height

        self._cell_size_in_pixels = cell_size
        self._cell_size_in_plane = cell_size * plane_width / image_width

        self._plane_width = plane_width
        self._plane_height = plane_width * image_height / image_width

        self._x_bottom_left = center[0] - plane_width / 2
        self._y_bottom_left = center[1] - self._plane_height / 2

        self._filename = filename

        self._cells = self._create_cells(max_n_iterations, radius, colormap)

    def _create_cell(self, center, max_n_iterations, radius, colormap):
        return Cell(center, self._cell_size_in_plane, max_n_iterations, radius, colormap)

    def _create_cells(self, max_n_iterations, radius, colormap):
        n_rows = int(self._image_height / self._cell_size_in_pixels)
        n_columns = int(self._image_width / self._cell_size_in_pixels)

        xs = n_rows * [
            self._x_bottom_left + (i + 0.5) * self._cell_size_in_plane for i in range(n_columns)
        ]
        ys = sorted(n_columns * [
            self._y_bottom_left + (i + 0.5) * self._cell_size_in_plane for i in range(n_rows)
        ])
        centers = zip(xs, ys)

        start_time = time.time()
        print('Coloring cells...', end='', flush=True)

        cells = joblib.Parallel(n_jobs=-1)(
            joblib.delayed(self._create_cell)(center, max_n_iterations, radius, colormap) for center in centers
        )

        elapsed_time = time.time() - start_time
        print(f'\rCells colored. ({elapsed_time:.2f} seconds)')

        return cells

    def generate(self):
        correction = 1.299
        dpi = 100

        plt.figure(figsize=(correction * self._image_width / dpi, correction * self._image_height / dpi), dpi=dpi)
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

        x_max = self._x_bottom_left + self._plane_width
        plt.xlim(self._x_bottom_left, x_max)

        y_max = self._y_bottom_left + self._plane_height
        plt.ylim(self._y_bottom_left, y_max)

        plt.xticks(list())
        plt.yticks(list())

        for spine in plt.gca().spines.values():
            spine.set_visible(False)

        images_directory_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'images')
        file_path = os.path.join(images_directory_path,
                                 f'{self._filename} ({self._image_width}x{self._image_height}).png')

        start_time = time.time()
        print('Saving image...', end='', flush=True)

        plt.savefig(file_path, bbox_inches='tight', pad_inches=0)

        elapsed_time = time.time() - start_time
        print(f'\rImage saved. ({elapsed_time:.2f} seconds)')

        plt.close()
