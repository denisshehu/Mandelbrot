import math

from matplotlib import colors


class Cell:
    __slots__ = ['_center', '_size', '_max_n_iterations', '_radius', '_colormap', '_n_iterations', '_color']

    def __init__(self, center, size, max_n_iterations, radius, colormap):
        self._center = center
        self._size = size
        self._max_n_iterations = max_n_iterations
        self._radius = radius
        self._colormap = colormap

        self._n_iterations = self._get_n_iterations()
        self._color = self._get_color()

    @property
    def color(self):
        return self._color

    def _get_n_iterations(self):
        x0, y0 = self._center
        x, y = 0, 0

        iteration = 0
        while x ** 2 + y ** 2 <= self._radius ** 2 and iteration < self._max_n_iterations:
            x_temporary = x ** 2 - y ** 2 + x0
            y = 2 * x * y + y0
            x = x_temporary
            iteration += 1

        if iteration < self._max_n_iterations:
            log_zn = math.log(x ** 2 + y ** 2) / 2
            nu = math.log(log_zn / math.log(2)) / math.log(2)
            iteration += 1 - nu

        return iteration

    def _get_color(self):
        norm = colors.LogNorm(1, self._max_n_iterations)
        return self._colormap(norm(self._n_iterations))

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
