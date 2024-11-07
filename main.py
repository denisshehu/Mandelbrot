from config import *
from models.image import Image
from utils import check_cell_size


def main():
    try:
        check_cell_size()

        for center, plane_width, filename in zip(centers, plane_widths, filenames):
            image = Image(image_width, image_height, cell_size, center, plane_width)
            image.generate(max_n_iterations, radius, colormap, filename)

    except ValueError as error:
        print(error)


if __name__ == '__main__':
    main()
