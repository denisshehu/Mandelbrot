import math

from matplotlib.colors import to_rgb, LinearSegmentedColormap as LSC
from matplotlib import pyplot as plt, colors


class Cell:

    def __init__(self, center, size):
        self._center = center
        self._size = size
        self._color = self._compute_color()

    @property
    def color(self):
        return self._color

    def _compute_color(self):
        x0, y0 = self._center
        x, y, x_squared, y_squared = 0, 0, 0, 0
        max_iteration = 1000

        iteration = 0
        while x_squared + y_squared <= 4 and iteration < max_iteration:
            y = 2 * x * y + y0
            x = x_squared - y_squared + x0
            x_squared = math.pow(x, 2)
            y_squared = math.pow(y, 2)
            iteration += 1

        blue = to_rgb('#00065C')
        white = to_rgb('#FFFFFF')
        black = to_rgb('#000000')
        colormap = LSC.from_list('colormap', list(zip([0.0, 0.5, 1.0], [blue, white, black])))
        # colormap = plt.get_cmap('seismic_r')
        norm = colors.LogNorm(1, max_iteration)
        return colormap(norm(iteration))

    def get_corners(self):
        x_center, y_center = self._center
        half_size = self._size / 2

        x_left = x_center - half_size
        x_right = x_center + half_size
        y_bottom = y_center - half_size
        y_top = y_center + half_size

        xs = [x_left, x_right, x_right, x_left, x_left]
        ys = [y_top, y_top, y_bottom, y_bottom, y_top]
        return xs, ys
