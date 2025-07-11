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
# This is the master list to prevent reading binary files.
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
    '.crx','.env','.ico'  # Chrome extension files are binary
}

# --- End Configuration ---

def is_binary_file(filepath):
    """
    Checks if a file is likely a binary file based on its extension.
    Returns True if the extension is in our blocklist, False otherwise.
    """
    _, ext = os.path.splitext(filepath)
    return ext.lower() in NON_TEXT_EXTENSIONS

def generate_tree(start_path, prefix="", ignore_list=None):
    """
    Recursively generates a visual directory tree structure.
    """
    if ignore_list is None:
        ignore_list = []
    
    ignore_set = set(ignore_list)
    lines = []
    
    try:
        entries = sorted([e for e in os.listdir(start_path) if e not in ignore_set])
    except OSError:
        return []

    dirs = [e for e in entries if os.path.isdir(os.path.join(start_path, e))]
    files = [e for e in entries if os.path.isfile(os.path.join(start_path, e))]
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
    
    with open(output_filename, 'w', encoding='utf-8', errors='replace') as outfile:
        abs_start_dir = os.path.abspath(start_dir)
        outfile.write(f"--- Project Snapshot of directory: {abs_start_dir} ---\n\n")
        
        print("🌳 Generating project tree...")
        outfile.write("--- Project Tree ---\n")
        outfile.write(f"{os.path.basename(abs_start_dir)}/\n")
        tree_lines = generate_tree(start_dir, ignore_list=ignore_list)
        outfile.writelines(tree_lines)
        outfile.write("\n" + "=" * 80 + "\n\n")
        print("Tree generation complete.")

        print("\n📄 Processing files...")
        for dirpath, dirnames, filenames in os.walk(start_dir, topdown=True):
            dirnames[:] = [d for d in dirnames if d not in ignore_list]

            for filename in sorted(filenames):
                if filename in ignore_list:
                    continue

                file_path = os.path.join(dirpath, filename)
                
                # The critical check happens here
                if is_binary_file(file_path):
                    # If it's binary, we log it and write a placeholder.
                    print(f"  -> Skipping binary file: {file_path}")
                    outfile.write(f"--- File: {file_path} ---\n")
                    ext = os.path.splitext(file_path)[1]
                    outfile.write(f"*** Binary file ({ext} extension). Content not included. ***\n")
                    outfile.write("\n\n" + "=" * 80 + "\n\n")
                else:
                    # Otherwise, we treat it as text and process it.
                    print(f"  -> Reading text file:    {file_path}")
                    outfile.write(f"--- File: {file_path} ---\n")
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as infile:
                            content = infile.read()
                            outfile.write(content)
                    except Exception as e:
                        outfile.write(f"*** Could not read file content. Reason: {e} ***\n")
                    outfile.write("\n\n" + "=" * 80 + "\n\n")

    print(f"\n✅ Success! Snapshot written to '{output_filename}'")


if __name__ == "__main__":
    create_project_snapshot()