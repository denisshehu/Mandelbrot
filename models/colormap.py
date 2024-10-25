from enum import Enum

from matplotlib.colors import to_rgb, LinearSegmentedColormap as LSC

dark_blue = to_rgb('#000764')
light_blue = to_rgb('#206BCB')
white = to_rgb('#FFFFFF')
orange = to_rgb('#FFAA00')
black = to_rgb('#000000')


class Colormap(Enum):
    DEFAULT = LSC.from_list('default', [dark_blue, light_blue, white, orange, black], N=1024)
