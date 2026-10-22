"""Shared helpers for the paper analysis scripts (PLAN 9.1, stream AN).

Every script in paper/scripts imports from here. Nothing in this package reads the system
clock into an output, and every random draw takes an explicit seed, so outputs are
byte-reproducible from the same inputs.
"""
