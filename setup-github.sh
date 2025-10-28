#!/bin/bash

echo "========================================"
echo "   Rectangle Packing Optimizer"
echo "   GitHub Setup Script"
echo "========================================"
echo

# Check if Git is installed
if ! command -v git &> /dev/null; then
    echo "ERROR: Git is not installed!"
    echo "Please install Git:"
    echo "  macOS: brew install git"
    echo "  Ubuntu/Debian: sudo apt install git"
    exit 1
fi

echo "Git is installed. Version:"
git --version
echo

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "ERROR: package.json not found!"
    echo "Please run this script from the project root directory."
    exit 1
fi

echo "Project directory found."
echo

# Initialize Git repository
echo "Initializing Git repository..."
git init
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to initialize Git repository"
    exit 1
fi

echo "Git repository initialized."
echo

# Add all files
echo "Adding files to Git..."
git add .
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to add files"
    exit 1
fi

echo "Files added to Git."
echo

# Initial commit
echo "Creating initial commit..."
git commit -m "Initial commit: Rectangle Packing Optimizer with Tailwind CSS and Electron"
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create initial commit"
    exit 1
fi

echo "Initial commit created."
echo

# Get GitHub username
read -p "Enter your GitHub username: " GITHUB_USERNAME
if [ -z "$GITHUB_USERNAME" ]; then
    echo "ERROR: GitHub username is required"
    exit 1
fi

# Add remote origin
echo "Adding remote origin..."
git remote add origin https://github.com/$GITHUB_USERNAME/rectangle-packing-optimizer.git
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to add remote origin"
    exit 1
fi

echo "Remote origin added."
echo

# Set main branch
echo "Setting main branch..."
git branch -M main
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to set main branch"
    exit 1
fi

echo "Main branch set."
echo

echo "========================================"
echo "   Setup completed successfully!"
echo "========================================"
echo
echo "Next steps:"
echo "1. Create a new repository on GitHub:"
echo "   https://github.com/new"
echo "   Repository name: rectangle-packing-optimizer"
echo "   Description: Ứng dụng desktop tối ưu sắp xếp hình chữ nhật"
echo "   Make it Public or Private"
echo "   DO NOT initialize with README, .gitignore, or license"
echo
echo "2. Push your code to GitHub:"
echo "   git push -u origin main"
echo
echo "3. Your repository will be available at:"
echo "   https://github.com/$GITHUB_USERNAME/rectangle-packing-optimizer"
echo

# Ask if user wants to push now
read -p "Do you want to push to GitHub now? (y/n): " PUSH_NOW
if [[ $PUSH_NOW =~ ^[Yy]$ ]]; then
    echo
    echo "Pushing to GitHub..."
    git push -u origin main
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to push to GitHub"
        echo "Please check your GitHub repository settings and try again."
        exit 1
    fi
    echo
    echo "========================================"
    echo "   Successfully pushed to GitHub!"
    echo "========================================"
    echo
    echo "Your repository is now available at:"
    echo "https://github.com/$GITHUB_USERNAME/rectangle-packing-optimizer"
    echo
else
    echo
    echo "You can push to GitHub later using:"
    echo "git push -u origin main"
    echo
fi

echo "Press Enter to exit..."
read
