# TaskWarrior Web UI

A responsive web interface for TaskWarrior that runs locally on both desktop (Ubuntu) and mobile (Android with Termux).

## Features

- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Task Management**: View, add, edit, and manage TaskWarrior tasks
- **Task Actions**: Start, stop, complete, and delete tasks
- **Task Modification**: Edit descriptions, tags, priorities, due dates, and scheduled dates
- **Real-time Updates**: Automatic refresh and notifications
- **Local Operation**: No external database or authentication required

## Prerequisites

- **TaskWarrior**: Must be installed and configured
  ```bash
  # Ubuntu/Debian
  sudo apt-get install taskwarrior
  
  # Initialize TaskWarrior (first time only)
  task
  ```

- **Python 3**: Required for the backend server
- **Flask**: Web framework (installed via requirements.txt)

## Installation

1. **Clone or download the project files**

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Ensure TaskWarrior is working**:
   ```bash
   task version
   task list
   ```

## Usage

### Desktop (Ubuntu)

1. **Start the server**:
   ```bash
   python3 app.py
   ```

2. **Access the web interface**:
   Open your browser and go to `http://localhost:5000`

### Mobile (Android with Termux)

1. **Install required packages in Termux**:
   ```bash
   pkg install python taskwarrior
   pip install flask flask-cors
   ```

2. **Start the server**:
   ```bash
   python app.py
   ```

3. **Access the web interface**:
   Open your browser and go to `http://localhost:5000`

## API Endpoints

The backend provides a REST API for TaskWarrior operations:

- `GET /api/tasks` - Get all pending tasks
- `POST /api/task/add` - Add a new task
- `POST /api/task/{id}/start` - Start a task
- `POST /api/task/{id}/stop` - Stop a task
- `POST /api/task/{id}/done` - Mark task as completed
- `DELETE /api/task/{id}/delete` - Delete a task
- `PUT /api/task/{id}/modify` - Modify task properties

## Task Actions

- **Start/Stop**: Begin or pause work on a task (integrates with TimeWarrior)
- **Done**: Mark a task as completed
- **Delete**: Remove a task permanently
- **Edit**: Modify task description, tags, priority, due date, or scheduled date

## File Structure

```
TaskWarrior-WebUI/
├── app.py              # Flask backend server
├── index.html          # Main HTML interface
├── styles.css          # Responsive CSS styles
├── main.js             # Frontend JavaScript
├── requirements.txt    # Python dependencies
└── README.md          # This file
```

## Customization

The interface can be customized by modifying:

- **styles.css**: Change colors, layout, and responsive behavior
- **main.js**: Modify frontend functionality and interactions
- **app.py**: Extend backend API or add new TaskWarrior integrations

## Troubleshooting

### TaskWarrior Not Found
```bash
# Check if TaskWarrior is installed
which task

# Install if missing
sudo apt-get install taskwarrior
```

### Permission Issues
```bash
# Ensure TaskWarrior data directory is accessible
ls -la ~/.task/
```

### Network Issues
- The server binds to `0.0.0.0:5000` to allow access from other devices
- For security, consider using `127.0.0.1:5000` for localhost-only access

## License

This project is open source and available under the MIT License.
