import os

# --- Configuration ---
# The name of the output file.
output_filename = 'project_snapshot.txt'
# A list of files and directories to ignore.
# We ignore the script itself, its output, and common large/binary directories.
ignore_list = [
    output_filename,
    os.path.basename(__file__),  # The script's own name
    '.git',
    '.gradle',
    'build',
    '__pycache__',
    '.idea'
]
# List of common non-text file extensions to handle gracefully.
# You can extend this list with more extensions if needed.
NON_TEXT_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp',  # Images
    '.unity', '.asset', '.mat', '.prefab', '.shader', '.anim', '.controller', # Unity specific
    '.wav', '.mp3', '.ogg', '.flac',  # Audio
    '.ttf', '.otf', '.woff', '.woff2',  # Fonts
    '.fbx', '.obj', '.blend', '.dae',  # 3D Models
    '.dll', '.exe', '.so', '.dylib',  # Binaries/Executables
    '.unitypackage', '.zip', '.rar', '.7z', '.tar', '.gz', # Archives
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', # Documents
    '.psd', '.ai', '.eps', # Design files
    '.mp4', '.mov', '.avi', '.mkv', # Videos
    '.json', '.xml', '.yaml', '.yml', # Data files that might be large or have complex structures
}

# --- End Configuration ---

def is_text_file(filepath):
    """
    Checks if a file is likely a text file based on its extension.
    Returns True if it's likely text, False otherwise.
    """
    _, ext = os.path.splitext(filepath)
    return ext.lower() not in NON_TEXT_EXTENSIONS

def create_project_snapshot():
    """
    Walks through the current directory and its subdirectories,
    reads the content of each file, and writes it to a single output file.
    Handles non-text files more gracefully.
    """
    # Open the output file for writing with UTF-8 encoding.
    with open(output_filename, 'w', encoding='utf-8', errors='replace') as outfile:
        # Get the starting directory path.
        start_dir = '.'
        outfile.write(f"--- Project Snapshot of directory: {os.path.abspath(start_dir)} ---\n\n")

        # os.walk() is perfect for this. It goes through every directory and file.
        for dirpath, dirnames, filenames in os.walk(start_dir, topdown=True):

            # --- Filtering Logic ---
            # We want to skip ignored directories entirely.
            # We must modify dirnames in place to prevent os.walk from entering them.
            # Example: If dirnames is ['.git', 'core', 'lwjgl3'], and '.git' is in ignore_list,
            # dirnames becomes ['core', 'lwjgl3'] for the next iteration.
            dirnames[:] = [d for d in dirnames if d not in ignore_list]

            # --- File Processing ---
            for filename in filenames:
                # Skip any explicitly ignored files.
                if filename in ignore_list:
                    continue

                # Get the full path to the file.
                file_path = os.path.join(dirpath, filename)

                # Write a clear header for each file.
                header = f"--- File: {file_path} ---\n"
                print(f"Processing: {file_path}")  # Log progress to the console.
                outfile.write(header)

                if is_text_file(file_path):
                    try:
                        # Open and read the content of the current file.
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as infile:
                            content = infile.read()
                            outfile.write(content)
                    except Exception as e:
                        # If reading fails (e.g., permission errors, encoding issues not caught by 'ignore')
                        error_message = f"*** Could not read file content. Reason: {e} ***\n"
                        outfile.write(error_message)
                else:
                    # For non-text files, write a placeholder message.
                    # You could optionally try to read a small portion or metadata if needed,
                    # but for a general snapshot, this is safer.
                    outfile.write(f"*** Non-text file ({os.path.splitext(file_path)[1]} extension). Content not displayed. ***\n")

                # Add spacing between files for better readability.
                outfile.write("\n" + "=" * 80 + "\n\n")

    print(f"\n✅ Success! All code and file summaries have been written to '{output_filename}'")


if __name__ == "__main__":
    create_project_snapshot()