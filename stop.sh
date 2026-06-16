#!/bin/bash
pkill -f "python.*backend.py" 2>/dev/null && echo "Server stopped" || echo "Server not running"