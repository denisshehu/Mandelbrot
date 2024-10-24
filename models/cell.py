import math

from matplotlib import colors
from matplotlib.colors import LinearSegmentedColormap as LSC


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
        x, y = 0, 0
        max_iteration = 1000
        radius = 2 ** 8

        iteration = 0
        while x ** 2 + y ** 2 <= radius ** 2 and iteration < max_iteration:
            x_temporary = x ** 2 - y ** 2 + x0
            y = 2 * x * y + y0
            x = x_temporary
            iteration += 1

        if iteration < max_iteration:
            log_zn = math.log(x ** 2 + y ** 2) / 2
            nu = math.log(log_zn / math.log(2)) / math.log(2)
            iteration += 1 - nu

        dark_blue = tuple(i / 255 for i in (0, 7, 100))
        light_blue = tuple(i / 255 for i in (32, 107, 203))
        white = tuple(i / 255 for i in (255, 255, 255))
        orange = tuple(i / 255 for i in (255, 170, 0))
        black = tuple(i / 255 for i in (0, 0, 0))
        colormap = LSC.from_list('colormap',
                                 list(zip([0.0, 0.25, 0.5, 0.75, 1.0], [dark_blue, light_blue, white, orange, black])))
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
