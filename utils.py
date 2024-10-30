import time

from sympy import divisors

from config import image_width, image_height, cell_size


def check_cell_size():
    common_divisors = set(divisors(image_width)).intersection(divisors(image_height))

    if not cell_size in common_divisors:
        valid_divisors = ', '.join(map(str, sorted(common_divisors)))
        raise ValueError(f'The cell size ({cell_size}) is not valid for image size {image_width}x{image_height}.\n'
                         f'The only valid cell sizes are {valid_divisors}.')


def run_and_time(function, *arguments, start_string, end_string):
    start_time = time.time()
    print(f'{start_string}...', end='', flush=True)
    function(*arguments)
    elapsed_time = time.time() - start_time
    print(f'\r{end_string}. ({elapsed_time:.2f} seconds)')
    return elapsed_time
