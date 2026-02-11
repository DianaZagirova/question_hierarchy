#!/bin/bash

# Omega Point Development Environment Manager
# Provides hot reloading for both frontend and backend

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if .env.dev exists
if [ ! -f ".env.dev" ]; then
    print_error ".env.dev not found!"
    echo "Please create .env.dev from .env.dev.example or .env"
    exit 1
fi

# Parse command
COMMAND=${1:-start}

case $COMMAND in
    start|up)
        echo ""
        echo "════════════════════════════════════════════════════════════"
        echo "  🚀 Starting Omega Point Development Environment"
        echo "════════════════════════════════════════════════════════════"
        echo ""

        print_info "Building and starting services..."
        docker-compose -f docker-compose.dev.yml up --build -d

        echo ""
        print_success "Development environment started!"
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  📝 Services"
        echo "═══════════════════════════════════════════════════════════"
        echo ""
        echo "  🌐 Frontend (Vite HMR):   http://localhost:5173"
        echo "  🔌 Backend API:            http://localhost:3003"
        echo "  🗄️  PostgreSQL:             localhost:5433"
        echo "  🔴 Redis:                  localhost:6380"
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  💡 Features"
        echo "═══════════════════════════════════════════════════════════"
        echo ""
        echo "  ✅ Hot Module Replacement (HMR) for frontend"
        echo "  ✅ Auto-reload for backend on code changes"
        echo "  ✅ Live session management with PostgreSQL"
        echo "  ✅ Redis caching enabled"
        echo ""
        echo "═══════════════════════════════════════════════════════════"
        echo "  🛠️  Commands"
        echo "═══════════════════════════════════════════════════════════"
        echo ""
        echo "  View logs:           ./dev.sh logs"
        echo "  Stop services:       ./dev.sh stop"
        echo "  Restart services:    ./dev.sh restart"
        echo "  View status:         ./dev.sh ps"
        echo ""
        ;;

    stop|down)
        echo ""
        print_info "Stopping development environment..."
        docker-compose -f docker-compose.dev.yml down
        print_success "Stopped!"
        echo ""
        ;;

    restart)
        echo ""
        print_info "Restarting development environment..."
        docker-compose -f docker-compose.dev.yml restart
        print_success "Restarted!"
        echo ""
        ;;

    logs)
        SERVICE=${2:-}
        if [ -z "$SERVICE" ]; then
            echo ""
            print_info "Showing logs for all services (Ctrl+C to exit)..."
            echo ""
            docker-compose -f docker-compose.dev.yml logs -f
        else
            echo ""
            print_info "Showing logs for $SERVICE (Ctrl+C to exit)..."
            echo ""
            docker-compose -f docker-compose.dev.yml logs -f "$SERVICE"
        fi
        ;;

    ps|status)
        echo ""
        print_info "Service status:"
        echo ""
        docker-compose -f docker-compose.dev.yml ps
        echo ""
        ;;

    rebuild)
        echo ""
        print_info "Rebuilding all containers..."
        docker-compose -f docker-compose.dev.yml up --build -d --force-recreate
        print_success "Rebuild complete!"
        echo ""
        ;;

    clean)
        echo ""
        print_warning "This will remove all containers, volumes, and images for dev environment"
        read -p "Are you sure? (y/N): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "Cleaning up..."
            docker-compose -f docker-compose.dev.yml down -v --rmi local
            print_success "Cleaned!"
        else
            print_info "Cancelled"
        fi
        echo ""
        ;;

    shell)
        SERVICE=${2:-backend}
        echo ""
        print_info "Opening shell in $SERVICE container..."
        echo ""
        docker-compose -f docker-compose.dev.yml exec "$SERVICE" sh
        ;;

    db)
        echo ""
        print_info "Connecting to PostgreSQL..."
        echo ""
        docker-compose -f docker-compose.dev.yml exec postgres psql -U omegapoint -d omegapoint
        ;;

    help|--help|-h)
        echo ""
        echo "Omega Point Development Environment Manager"
        echo ""
        echo "Usage: ./dev.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start, up         Start development environment with hot reloading"
        echo "  stop, down        Stop all services"
        echo "  restart           Restart all services"
        echo "  logs [service]    View logs (all services or specific one)"
        echo "  ps, status        Show service status"
        echo "  rebuild           Force rebuild all containers"
        echo "  clean             Remove all containers, volumes, and images"
        echo "  shell [service]   Open shell in container (default: backend)"
        echo "  db                Connect to PostgreSQL"
        echo "  help              Show this help message"
        echo ""
        echo "Examples:"
        echo "  ./dev.sh start              # Start dev environment"
        echo "  ./dev.sh logs frontend      # View frontend logs"
        echo "  ./dev.sh shell backend      # Open backend shell"
        echo ""
        ;;

    *)
        print_error "Unknown command: $COMMAND"
        echo ""
        echo "Run './dev.sh help' for usage information"
        echo ""
        exit 1
        ;;
esac
