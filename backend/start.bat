@echo off
REM Run this from the backend folder, or double-click it.
REM Make sure Ollama is already running (check with: ollama list)

if not exist env (
    echo Creating virtual environment...
    python -m venv env
)

call env\Scripts\activate.bat

echo Installing/checking dependencies...
pip install -r requirements.txt

echo.
echo Starting TitanHand backend server...
python server.py
