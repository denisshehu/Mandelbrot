import os.path

from joblib import Parallel, delayed
from matplotlib import pyplot as plt
from matplotlib.collections import PolyCollection

from models.cell import Cell
from utils import run_and_time


class Image:

    def __init__(self, image_width, image_height, cell_size, center, plane_width):
        self._image_width = image_width
        self._image_height = image_height

        self._cell_size_in_pixels = cell_size
        self._cell_size_in_plane = cell_size * plane_width / image_width

        self._plane_width = plane_width
        self._plane_height = plane_width * image_height / image_width

        self._x_bottom_left = center[0] - plane_width / 2
        self._y_bottom_left = center[1] - self._plane_height / 2

        self._cells = None

    def generate(self, max_n_iterations, radius, colormap, filename):
        steps = [
            (self._create_cells, [max_n_iterations, radius, colormap], 'Creating cells', 'Cells created'),
            (self._compute_n_iterations, [], 'Calculating cell escape times', 'Cell escape times calculated'),
            (self._compute_color, [], 'Coloring cells', 'Cells colored'),
            (self._plot, [], 'Generating image', 'Image generated'),
            (self._save, [filename], 'Saving image', 'Image saved')
        ]

        elapsed_time = 0
        for function, arguments, start_string, end_string in steps:
            elapsed_time += run_and_time(
                function, *arguments, start_string=start_string, end_string=end_string
            )
        print(f'Total runtime: {elapsed_time:.2f} seconds ({(elapsed_time / 60):.2f} minutes)\n')

    def _create_cells(self, max_n_iterations, radius, colormap):
        n_rows = int(self._image_height / self._cell_size_in_pixels)
        n_columns = int(self._image_width / self._cell_size_in_pixels)

        xs = n_rows * [self._x_bottom_left + (i + 0.5) * self._cell_size_in_plane for i in range(n_columns)]
        ys = sorted(n_columns * [self._y_bottom_left + (i + 0.5) * self._cell_size_in_plane for i in range(n_rows)])
        centers = zip(xs, ys)

        self._cells = [Cell(center, self._cell_size_in_plane, max_n_iterations, radius, colormap) for center in centers]

    def _compute_n_iterations(self):
        results = Parallel(n_jobs=-1)(delayed(lambda cell: cell.get_n_iterations())(cell) for cell in self._cells)
        for cell, n_iterations in zip(self._cells, results):
            cell.n_iterations = n_iterations

    def _compute_color(self):
        min_n_iterations = min(cell.n_iterations for cell in self._cells)
        results = Parallel(n_jobs=-1)(
            delayed(lambda cell: cell.get_color(min_n_iterations))(cell) for cell in self._cells)
        for cell, color in zip(self._cells, results):
            cell.color = color

    def _plot(self):
        correction = 1.299
        dpi = 100

        plt.figure(figsize=(correction * self._image_width / dpi, correction * self._image_height / dpi), dpi=dpi)
        plt.gca().set_aspect('equal')

        corners = list()
        colors = list()
        for cell in self._cells:
            xs, ys = cell.get_corners()
            corners.append(list(zip(xs, ys)))
            colors.append(cell.color)

        plt.gca().add_collection(PolyCollection(corners, color=colors, edgecolors=None))

        x_max = self._x_bottom_left + self._plane_width
        plt.xlim(self._x_bottom_left, x_max)

        y_max = self._y_bottom_left + self._plane_height
        plt.ylim(self._y_bottom_left, y_max)

        plt.xticks(list())
        plt.yticks(list())

        for spine in plt.gca().spines.values():
            spine.set_visible(False)

    def _save(self, filename):
        images_directory_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'images')
        file_path = os.path.join(images_directory_path, f'{filename} ({self._image_width}x{self._image_height}).png')
        plt.savefig(file_path, bbox_inches='tight', pad_inches=0)
        plt.close()
