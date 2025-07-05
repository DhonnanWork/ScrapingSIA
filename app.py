import os
import json
from flask import Flask, jsonify, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow your browser extension to call this API

# This is the directory where your scraper saves its data.
# On Render, this will be the path to your persistent disk.
# For local testing, it's a 'scraped_data' folder in your project.
DATA_DIR = os.path.join(os.getcwd(), 'scraped_data')

@app.route('/api/courses', methods=['GET'])
def get_courses():
    """
    Endpoint to get the list of all courses.
    Reads 'courses_list.json'.
    """
    file_path = os.path.join(DATA_DIR, 'courses_list.json')
    if not os.path.exists(file_path):
        # If the scraper hasn't run yet, return an empty list.
        return jsonify([])
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        print(f"Error reading courses_list.json: {e}")
        # Use abort(500) to send a server error response.
        abort(500, description="Internal server error while reading course list.")

@app.route('/api/course/<string:course_filename>', methods=['GET'])
def get_course_detail(course_filename):
    """
    Endpoint to get the detailed data for a single course.
    Example: /api/course/MI2A01-Pemrograman-Berorientasi-Objek.json
    """
    # Security: Ensure the filename is safe. This prevents users
    # from trying to access files outside the data directory (e.g., ../../.env)
    if '..' in course_filename or course_filename.startswith('/'):
        abort(400, description="Invalid filename.")

    file_path = os.path.join(DATA_DIR, course_filename)
    if not os.path.exists(file_path):
        abort(404, description=f"Course data not found for {course_filename}")
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        print(f"Error reading {course_filename}: {e}")
        abort(500, description=f"Internal server error while reading course data.")

if __name__ == '__main__':
    # For local testing:
    # 1. Run scraper.py first to generate the data.
    # 2. Run this app.py file.
    # 3. Access http://127.0.0.1:5000/api/courses in your browser.
    app.run(debug=True, port=5000)