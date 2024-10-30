from models.colormap import Colormap

image_width = 1920
image_height = 1080
cell_size = 1

centers = [(-0.75, 0),
           (0.16125, 0.638438),
           (-0.743517833, 0.127094578)]
plane_widths = [4.2,
                0.05,
                0.019]

max_n_iterations = 1000
radius = 2 ** 8
colormap = Colormap.DEFAULT.value

filenames = ['Default',
             'Focused',
             'Seahorse']
