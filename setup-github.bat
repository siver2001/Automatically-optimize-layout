@echo off
echo ========================================
echo    Rectangle Packing Optimizer
echo    GitHub Setup Script
echo ========================================
echo.

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed!
    echo Please install Git from: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo Git is installed. Version:
git --version
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ERROR: package.json not found!
    echo Please run this script from the project root directory.
    pause
    exit /b 1
)

echo Project directory found.
echo.

REM Initialize Git repository
echo Initializing Git repository...
git init
if %errorlevel% neq 0 (
    echo ERROR: Failed to initialize Git repository
    pause
    exit /b 1
)

echo Git repository initialized.
echo.

REM Add all files
echo Adding files to Git...
git add .
if %errorlevel% neq 0 (
    echo ERROR: Failed to add files
    pause
    exit /b 1
)

echo Files added to Git.
echo.

REM Initial commit
echo Creating initial commit...
git commit -m "Initial commit: Rectangle Packing Optimizer with Tailwind CSS and Electron"
if %errorlevel% neq 0 (
    echo ERROR: Failed to create initial commit
    pause
    exit /b 1
)

echo Initial commit created.
echo.

REM Get GitHub username
set /p GITHUB_USERNAME="Enter your GitHub username: "
if "%GITHUB_USERNAME%"=="" (
    echo ERROR: GitHub username is required
    pause
    exit /b 1
)

REM Add remote origin
echo Adding remote origin...
git remote add origin https://github.com/%GITHUB_USERNAME%/rectangle-packing-optimizer.git
if %errorlevel% neq 0 (
    echo ERROR: Failed to add remote origin
    pause
    exit /b 1
)

echo Remote origin added.
echo.

REM Set main branch
echo Setting main branch...
git branch -M main
if %errorlevel% neq 0 (
    echo ERROR: Failed to set main branch
    pause
    exit /b 1
)

echo Main branch set.
echo.

echo ========================================
echo    Setup completed successfully!
echo ========================================
echo.
echo Next steps:
echo 1. Create a new repository on GitHub:
echo    https://github.com/new
echo    Repository name: rectangle-packing-optimizer
echo    Description: Ứng dụng desktop tối ưu sắp xếp hình chữ nhật
echo    Make it Public or Private
echo    DO NOT initialize with README, .gitignore, or license
echo.
echo 2. Push your code to GitHub:
echo    git push -u origin main
echo.
echo 3. Your repository will be available at:
echo    https://github.com/%GITHUB_USERNAME%/rectangle-packing-optimizer
echo.
echo Press any key to continue...
pause >nul

REM Ask if user wants to push now
set /p PUSH_NOW="Do you want to push to GitHub now? (y/n): "
if /i "%PUSH_NOW%"=="y" (
    echo.
    echo Pushing to GitHub...
    git push -u origin main
    if %errorlevel% neq 0 (
        echo ERROR: Failed to push to GitHub
        echo Please check your GitHub repository settings and try again.
        pause
        exit /b 1
    )
    echo.
    echo ========================================
    echo    Successfully pushed to GitHub!
    echo ========================================
    echo.
    echo Your repository is now available at:
    echo https://github.com/%GITHUB_USERNAME%/rectangle-packing-optimizer
    echo.
) else (
    echo.
    echo You can push to GitHub later using:
    echo git push -u origin main
    echo.
)

echo Press any key to exit...
pause >nul
