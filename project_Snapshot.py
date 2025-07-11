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
    '.idea',
    '.vs',
    '.vscode',
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
    '.crx','.ico',
}

# --- End Configuration ---

def is_text_file(filepath):
    """
    Checks if a file is likely a text file based on its extension.
    Returns True if it's likely text, False otherwise.
    """
    _, ext = os.path.splitext(filepath)
    return ext.lower() not in NON_TEXT_EXTENSIONS

def generate_tree(start_path, prefix="", ignore_list=None):
    """
    Recursively generates a visual directory tree structure.
    """
    if ignore_list is None:
        ignore_list = []
    
    # Use a set for faster lookups
    ignore_set = set(ignore_list)
    
    lines = []
    try:
        # Get directory contents, filtering out ignored items
        entries = [e for e in os.listdir(start_path) if e not in ignore_set]
        entries.sort()
    except OSError:
        return [] # Cannot access directory

    # Separate directories and files to list directories first
    dirs = [e for e in entries if os.path.isdir(os.path.join(start_path, e))]
    files = [e for e in entries if os.path.isfile(os.path.join(start_path, e))]
    
    # Combine them for processing
    all_entries = dirs + files
    
    for i, entry in enumerate(all_entries):
        is_last = i == (len(all_entries) - 1)
        connector = "└── " if is_last else "├── "
        lines.append(f"{prefix}{connector}{entry}\n")
        
        if entry in dirs:
            new_prefix = prefix + ("    " if is_last else "│   ")
            lines.extend(generate_tree(os.path.join(start_path, entry), new_prefix, ignore_list))
    
    return lines

def create_project_snapshot():
    """
    Generates a project snapshot including a directory tree and file contents.
    """
    start_dir = '.'
    
    # Open the output file for writing with UTF-8 encoding.
    with open(output_filename, 'w', encoding='utf-8', errors='replace') as outfile:
        # --- 1. Write Header and Project Tree ---
        abs_start_dir = os.path.abspath(start_dir)
        outfile.write(f"--- Project Snapshot of directory: {abs_start_dir} ---\n\n")
        
        print("🌳 Generating project tree...")
        outfile.write("--- Project Tree ---\n")
        # Start the tree with the root directory name
        outfile.write(f"{os.path.basename(abs_start_dir)}/\n")
        tree_lines = generate_tree(start_dir, ignore_list=ignore_list)
        outfile.writelines(tree_lines)
        outfile.write("\n" + "=" * 80 + "\n\n")
        print("Tree generation complete.")

        # --- 2. Write File Contents ---
        print("\n📄 Processing files...")
        # os.walk() is perfect for this. It goes through every directory and file.
        for dirpath, dirnames, filenames in os.walk(start_dir, topdown=True):
            # We want to skip ignored directories entirely.
            # We must modify dirnames in place to prevent os.walk from entering them.
            dirnames[:] = [d for d in dirnames if d not in ignore_list]

            for filename in sorted(filenames):
                # Skip any explicitly ignored files.
                if filename in ignore_list:
                    continue

                file_path = os.path.join(dirpath, filename)
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
                        # If reading fails (e.g., permission errors)
                        error_message = f"*** Could not read file content. Reason: {e} ***\n"
                        outfile.write(error_message)
                else:
                    # For non-text files, write a placeholder message.
                    ext = os.path.splitext(file_path)[1]
                    outfile.write(f"*** Non-text file ({ext} extension). Content not displayed. ***\n")

                # Add spacing between files for better readability.
                outfile.write("\n\n" + "=" * 80 + "\n\n")

    print(f"\n✅ Success! All code and file summaries have been written to '{output_filename}'")


if __name__ == "__main__":
    create_project_snapshot()