# Mandelbrot Set Image Generator

Welcome to my Mandelbrot Set Image Generator project! This is a personal project I built for fun and as a way to explore
the mesmerizing complexity of the [Mandelbrot set](https://en.wikipedia.org/wiki/Mandelbrot_set). Using this program,
you can generate high-resolution images of the Mandelbrot set, which you can use as custom wallpapers or creative pixel
art.

This code uses the
[escape time algorithm](https://en.wikipedia.org/wiki/Plotting_algorithms_for_the_Mandelbrot_set#Escape_time_algorithm)
to determine the color of the points in the complex plane. Unlike the classic "banded" appearance of the escape time
algorithm, this implementation applies *smooth coloring* to create gradient transitions between colors. The resulting
images are vivid and seamless, showing the intricate structures of the Mandelbrot set in greater detail. I
use [matplotlib](https://matplotlib.org/) to render and save these images.

![](images/1.%20Mandelbrot%20(3840x2160).png)
`center = (-0.7, 0)` and `plane_width = 4.2`

## Parameters

Below are the parameters you can customize to create images tailored to your preferences:

- `image_width` (**int**): Width of the image in pixels. Default is 3840 for 4K resolution.


- `image_height` (**int**): Height of the image in pixels. Default is 2160 for 4K resolution.


- `cell_size` (**int**): The size of each cell, which is composed of *n×n* pixels. By default, `cell_size` is 1, meaning
  each cell is a single pixel. Increasing `cell_size` can create a *pixelated* effect in the image. Note that the
  specified `cell_size` must be a common divisor of both `image_width` and `image_height`. If this is not the case, the
  program will suggest valid `cell_size` values.


- `center` (**tuple of float**): The coordinates (x, y) of the center of the image in the complex plane. This allows you
  to zoom in on specific areas of the Mandelbrot set.


- `plane_width` (**float**): The width of the complex plane displayed, or the difference in the x-coordinate range
  between the leftmost and rightmost points in the image. Smaller values zoom in for higher detail.


- `max_n_iterations` (**int**): The maximum number of iterations for the escape time algorithm. A higher value increases
  detail but also increases computation time. Default is 1000.


- `radius` (**float**): The radius for the escape condition. A point is considered to be part of the Mandelbrot set if,
  after `max_n_iterations` iterations, it remains within a circle of radius `radius`. Default is 256.


- `colormap` (**list of colors**): The colormap used to color the cells based on their escape times. By default, this
  uses a linear gradient from dark blue to light blue, then white, orange, and black.


- `filename` (**string**): The name of the image file to save in the [images](images) folder.

## Example Images

Here are a few examples generated with this script using the default parameter values:

![Flower](images/2.%20Flower%20(3840x2160).png)
`center = (0.16125, 0.638438)` and `plane_width = 0.05`

&nbsp;
![Seahorse](images/3.%20Seahorse%20(3840x2160).png)
`center = (-0.743517833, 0.127094578)` and `plane_width = 0.019`
