import os

# --- Configuration ---
# The name of the output file.
output_filename = 'project_snapshot.txt'

# A list of files and directories to ignore in both the tree and the content snapshot.
ignore_list = [
    output_filename,
    os.path.basename(__file__),  # The script's own name
    '.git',                      # Git version control folder
    '.gradle',                   # Gradle's cache and wrapper files
    'build',                     # Compiled output directory
    '__pycache__',               # Python cache directory
    '.idea',                     # IDE-specific settings folder
    'core/bin',                  # Specific compiled output folders
    'lwjgl3/bin',
]

# List of file extensions that should be treated as non-text (binary).
# The script will not attempt to read the content of these files.
NON_TEXT_EXTENSIONS = {
    # Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico',
    # Fonts
    '.ttf', '.otf', '.woff', '.woff2',
    # Audio
    '.wav', '.mp3', '.ogg', '.flac',
    # Video
    '.mp4', '.mov', '.avi', '.mkv',
    # 3D Models & Assets
    '.fbx', '.obj', '.blend', '.dae', '.ase',
    # Compiled Code & Binaries
    '.class', '.jar', '.exe', '.dll', '.so', '.dylib', '.bin',
    # Archives
    '.zip', '.rar', '.7z', '.tar', '.gz', '.unitypackage',
    # Documents & Design Files
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.psd', '.ai', '.eps',
    # Other
    '.icns','.crx','.pem','..env'
}

# --- End Configuration ---

def generate_and_write_tree(outfile, start_dir, ignore_list):
    """
    Generates a directory tree structure and writes it to the output file.
    """
    outfile.write("--- Project File Structure ---\n\n")
    
    # The root directory doesn't have a prefix.
    outfile.write(f"{os.path.abspath(start_dir)}\n")

    # We use a recursive helper function to build the tree.
    _recursive_tree_builder(outfile, start_dir, "", ignore_list)
    
    outfile.write("\n" + "=" * 80 + "\n\n")
    print("✅ Project tree generated.")

def _recursive_tree_builder(outfile, directory, prefix, ignore_list):
    """A recursive helper to build and write the file tree."""
    try:
        # Get all entries in the directory, then filter and sort them.
        entries = os.listdir(directory)
        entries = sorted([e for e in entries if e not in ignore_list])
    except OSError:
        # Ignore directories we can't read.
        return

    for i, entry in enumerate(entries):
        is_last = (i == len(entries) - 1)
        # Use different connectors for the last item in a directory.
        connector = "└── " if is_last else "├── "
        
        outfile.write(f"{prefix}{connector}{entry}\n")
        
        path = os.path.join(directory, entry)
        if os.path.isdir(path):
            # The prefix for children is extended based on whether the current item was the last.
            extension = "    " if is_last else "│   "
            _recursive_tree_builder(outfile, path, prefix + extension, ignore_list)

def is_text_file(filepath):
    """
    Checks if a file is likely a text file based on its extension.
    """
    if '.' not in os.path.basename(filepath):
        return True # Treat files with no extension as text
    _, ext = os.path.splitext(filepath)
    return ext.lower() not in NON_TEXT_EXTENSIONS

def create_project_snapshot():
    """
    Creates a snapshot of the project, starting with a file tree,
    followed by the content of all text-based files.
    """
    with open(output_filename, 'w', encoding='utf-8', errors='replace') as outfile:
        # --- 1. Generate and write the project tree first ---
        generate_and_write_tree(outfile, '.', ignore_list)

        # --- 2. Write the content of each file ---
        outfile.write("--- File Contents ---\n\n")
        
        for dirpath, dirnames, filenames in os.walk('.', topdown=True):
            # Filter directories and files based on the ignore list.
            dirnames[:] = [d for d in dirnames if d not in ignore_list]
            
            for filename in sorted(filenames): # Sort for consistent order
                if filename in ignore_list:
                    continue

                file_path = os.path.join(dirpath, filename)
                header = f"--- File: {file_path} ---\n"
                print(f"Processing: {file_path}")
                outfile.write(header)

                if is_text_file(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as infile:
                            content = infile.read()
                            outfile.write(content)
                    except Exception as e:
                        outfile.write(f"*** Could not read file content. Reason: {e} ***\n")
                else:
                    ext = os.path.splitext(file_path)[1]
                    outfile.write(f"*** Non-text file detected ({ext}). Content not displayed. ***\n")

                outfile.write("\n" + "=" * 80 + "\n\n")

    print(f"\n✅ Success! Project snapshot has been written to '{output_filename}'")


if __name__ == "__main__":
    create_project_snapshot()   