"""Orbit Finder API."""

import os

# rasterio wheels ship their own PROJ database; a system-wide PROJ_LIB (e.g. set by a PostGIS
# install) points them at an incompatible one.
os.environ.pop("PROJ_LIB", None)
os.environ.pop("PROJ_DATA", None)
# Read public COGs over HTTP efficiently: no S3 credentials, no directory listing, merged ranges.
for k, v in {
    "AWS_NO_SIGN_REQUEST": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MULTIPLEX": "YES",
    "VSI_CACHE": "TRUE",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
}.items():
    os.environ.setdefault(k, v)
