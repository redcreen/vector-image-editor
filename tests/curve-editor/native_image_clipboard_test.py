"""Offline native image metadata recovery tests. Never read/write the pasteboard."""
import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import struct
import zlib
import tempfile
import unittest

from PIL import Image, TiffImagePlugin

SOURCE = Path(__file__).resolve().parents[2] / 'tools/curve-editor/native-image-clipboard.swift'

@unittest.skipUnless(sys.platform == 'darwin', 'AppKit requires macOS')
class NativeImageClipboardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SOURCE.exists(), 'Native clipboard image helper is not implemented'
        cls.temp = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.temp.name) / 'helper'
        subprocess.run(['swiftc', str(SOURCE), '-o', str(cls.binary)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def image(self):
        image = Image.new('RGB', (17, 11))
        image.putdata([(x * 13 % 256, x * 47 % 256, x * 83 % 256) for x in range(187)])
        return image

    def encode(self, image, fmt='PNG', **kwargs):
        output = io.BytesIO()
        image.save(output, format=fmt, **kwargs)
        return output.getvalue()

    def run_helper(self, pasted, *candidates, raw=None):
        args = [str(self.binary)]
        for i, data in enumerate(candidates):
            path = Path(self.temp.name) / f'candidate-{i}'
            path.write_bytes(data)
            args += ['--candidate-file', str(path)]
        if not candidates:
            # Always select offline mode, even for invalid-input tests.
            args += ['--candidate-file', str(Path(self.temp.name) / 'missing')]
        request = raw if raw is not None else json.dumps({'data': base64.b64encode(pasted).decode()})
        result = subprocess.run(args, input=request, text=True, capture_output=True, timeout=20, check=True)
        return json.loads(result.stdout)

    def assert_dpi(self, result, x, y, *, default=False):
        metadata = result['metadata']
        self.assertIsNotNone(metadata, result)
        self.assertAlmostEqual(metadata['dpiX'], x, delta=.02)
        self.assertAlmostEqual(metadata['dpiY'], y, delta=.02)
        self.assertEqual(metadata['orientation'], 1)
        self.assertEqual(metadata['source'], 'macos-clipboard')
        self.assertEqual(metadata.get('defaultDpi', False), default)

    def test_png_explicit_dpi(self):
        self.assert_dpi(self.run_helper(self.encode(self.image()), self.encode(self.image(), dpi=(300, 150))), 300, 150)

    def test_tiff_explicit_dpi(self):
        self.assert_dpi(self.run_helper(self.encode(self.image()), self.encode(self.image(), 'TIFF', dpi=(240, 120))), 240, 120)

    def test_tiff_centimeters(self):
        tags = TiffImagePlugin.ImageFileDirectory_v2()
        tags[282], tags[283], tags[296] = 100, 50, 3
        self.assert_dpi(self.run_helper(self.encode(self.image()), self.encode(self.image(), 'TIFF', tiffinfo=tags)), 254, 127)

    def test_no_dpi_is_not_default_72(self):
        for fmt in ('PNG', 'TIFF', 'JPEG'):
            candidate = self.encode(self.image(), fmt)
            pasted = self.encode(self.image()) if fmt == 'TIFF' else candidate
            self.assertIsNone(self.run_helper(pasted, candidate)['metadata'])

    def test_unitless_tiff_rejected(self):
        tags = TiffImagePlugin.ImageFileDirectory_v2()
        tags[282], tags[283], tags[296] = 300, 300, 1
        candidate = self.encode(self.image(), 'TIFF', tiffinfo=tags)
        self.assertIsNone(self.run_helper(self.encode(self.image()), candidate)['metadata'])

    def test_jpeg_explicit_jfif(self):
        candidate = self.encode(self.image(), 'JPEG', dpi=(300, 150))
        self.assert_dpi(self.run_helper(candidate, candidate), 300, 150)

    def test_a4_pixel_dimensions_default_to_100_dpi(self):
        image = Image.new('RGB', (826, 1168), 'white')
        pasted = self.encode(image)
        for fmt in ('PNG', 'TIFF', 'JPEG'):
            candidate = self.encode(image, fmt)
            with self.subTest(fmt=fmt):
                self.assert_dpi(self.run_helper(pasted, candidate), 100, 100, default=True)

    def test_landscape_a4_pixel_dimensions_default_to_100_dpi(self):
        candidate = self.encode(Image.new('RGB', (1168, 826), 'white'), 'JPEG')
        self.assert_dpi(self.run_helper(candidate, candidate), 100, 100, default=True)

    def test_default_requires_exact_a4_pixel_dimensions(self):
        candidate = self.encode(Image.new('RGB', (825, 1168), 'white'), 'JPEG')
        self.assertIsNone(self.run_helper(candidate, candidate)['metadata'])

    def test_orientation_normalization_preserves_a4_default(self):
        image = Image.new('RGB', (826, 1168), 'white')
        tags = TiffImagePlugin.ImageFileDirectory_v2()
        tags[274] = 6
        candidate = self.encode(image, 'TIFF', tiffinfo=tags)
        pasted = self.encode(Image.new('RGB', (1168, 826), 'white'))
        self.assert_dpi(self.run_helper(pasted, candidate), 100, 100, default=True)

    def test_explicit_resolution_takes_priority_over_a4_default(self):
        image = Image.new('RGB', (826, 1168), 'white')
        unitless = self.encode(image, 'JPEG')
        explicit = self.encode(image, 'PNG', dpi=(300, 150))
        self.assert_dpi(self.run_helper(unitless, unitless, explicit), 300, 150)

    def test_rotated_exif_tiff(self):
        tags = TiffImagePlugin.ImageFileDirectory_v2()
        tags[274] = 6
        candidate = self.encode(self.image(), 'TIFF', tiffinfo=tags, dpi=(300, 150))
        pasted = self.encode(self.image().transpose(Image.Transpose.ROTATE_270))
        self.assert_dpi(self.run_helper(pasted, candidate), 150, 300)

    def test_jpeg_explicit_exif(self):
        exif = Image.Exif()
        exif[282], exif[283], exif[296] = 240, 120, 2
        candidate = self.encode(self.image(), 'JPEG', exif=exif)
        self.assert_dpi(self.run_helper(candidate, candidate), 240, 120)

    def test_all_exif_orientations(self):
        transforms = [None, Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.ROTATE_180,
                      Image.Transpose.FLIP_TOP_BOTTOM, Image.Transpose.TRANSPOSE,
                      Image.Transpose.ROTATE_270, Image.Transpose.TRANSVERSE,
                      Image.Transpose.ROTATE_90]
        for orientation, transform in enumerate(transforms, 1):
            tags = TiffImagePlugin.ImageFileDirectory_v2()
            tags[274] = orientation
            candidate = self.encode(self.image(), 'TIFF', tiffinfo=tags, dpi=(300, 150))
            pasted = self.encode(self.image().transpose(transform) if transform is not None else self.image())
            with self.subTest(orientation=orientation):
                self.assert_dpi(self.run_helper(pasted, candidate), *( (150, 300) if orientation >= 5 else (300, 150)))

    def test_unsupported_pasted_format(self):
        candidate = self.encode(self.image(), 'TIFF', dpi=(300, 300))
        self.assertIsNone(self.run_helper(candidate, candidate)['metadata'])

    def test_consistent_representations(self):
        self.assert_dpi(self.run_helper(self.encode(self.image()), self.encode(self.image(), dpi=(300, 150)), self.encode(self.image(), 'TIFF', dpi=(300, 150))), 300, 150)

    def test_same_dimensions_different_pixels(self):
        other = self.image()
        other.putpixel((5, 5), (0, 0, 0))
        self.assertIsNone(self.run_helper(self.encode(other), self.encode(self.image(), dpi=(300, 300)))['metadata'])

    def test_conflicting_matching_representations(self):
        self.assertIsNone(self.run_helper(self.encode(self.image()), self.encode(self.image(), dpi=(300, 300)), self.encode(self.image(), 'TIFF', dpi=(150, 150)))['metadata'])

    def test_invalid_and_truncated_input(self):
        for data in (b'', b'garbage', self.encode(self.image())[:30]):
            self.assertIsNone(self.run_helper(data, data)['metadata'])
        for raw in ('{', '{}', '{"data":"%%%"}'):
            self.assertIsNone(self.run_helper(b'', raw=raw)['metadata'])

    def test_oversize_axis(self):
        image = Image.new('RGB', (30001, 1))
        data = self.encode(image, dpi=(300, 300))
        self.assertIsNone(self.run_helper(data, data)['metadata'])

    def test_oversize_pixel_count(self):
        # Rewrite IHDR without allocating an oversized source raster.
        data = bytearray(self.encode(self.image(), dpi=(300, 300)))
        data[16:24] = struct.pack('>II', 9000, 9000)
        data[29:33] = struct.pack('>I', zlib.crc32(data[12:29]))
        self.assertIsNone(self.run_helper(bytes(data), bytes(data))['metadata'])

    def test_unitless_png_rejected(self):
        candidate = bytearray(self.encode(self.image(), dpi=(300, 300)))
        tag = candidate.index(b'pHYs')
        candidate[tag + 12] = 0
        candidate[tag + 13:tag + 17] = struct.pack('>I', zlib.crc32(candidate[tag:tag + 13]))
        self.assertIsNone(self.run_helper(self.encode(self.image()), bytes(candidate))['metadata'])

    def test_oversize_candidate(self):
        self.assertIsNone(self.run_helper(self.encode(self.image()), b'x' * (32 * 1024 * 1024 + 1))['metadata'])

    def test_webp_pasted(self):
        self.assert_dpi(self.run_helper(self.encode(self.image(), 'WEBP', lossless=True), self.encode(self.image(), 'TIFF', dpi=(300, 150))), 300, 150)

    def test_oversize_request(self):
        self.assertIsNone(self.run_helper(b'x' * (18 * 1024 * 1024 + 1))['metadata'])

if __name__ == '__main__':
    unittest.main()
