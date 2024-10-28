from sympy import divisors

from config import *
from models.image import Image


def check_cell_size():
    common_divisors = set(divisors(image_width)).intersection(divisors(image_height))

    if not cell_size in common_divisors:
        valid_divisors = ', '.join(map(str, sorted(common_divisors)))
        raise ValueError(f'The cell size ({cell_size}) is not valid for image size {image_width}x{image_height}.\n'
                         f'The only valid cell sizes are {valid_divisors}.')


def main():
    try:
        check_cell_size()

        image = Image(
            image_width, image_height, cell_size, center, plane_width, max_n_iterations, radius, colormap, filename
        )
        image.generate()

    except ValueError as error:
        print(error)


if __name__ == '__main__':
    main()
