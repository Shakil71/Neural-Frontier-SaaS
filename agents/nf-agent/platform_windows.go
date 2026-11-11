//go:build windows

package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"unsafe"
)

// The installer (GET /api/agent/v1/install.ps1) restricts this folder to SYSTEM and
// Administrators, so the agent token in agent.json is not readable by other users.
var defaultConfigPath = filepath.Join(programData(), "NeuralFrontier", "agent.json")

const machineIDHint = "the MachineGuid registry value is missing or invalid"

const serviceName = "nf-agent"

func programData() string {
	if p := os.Getenv("ProgramData"); p != "" {
		return p
	}
	return `C:\ProgramData`
}

// Windows service control, through advapi32 directly (no third-party packages).
var (
	advapi32                         = syscall.NewLazyDLL("advapi32.dll")
	procStartServiceCtrlDispatcherW  = advapi32.NewProc("StartServiceCtrlDispatcherW")
	procRegisterServiceCtrlHandlerEx = advapi32.NewProc("RegisterServiceCtrlHandlerExW")
	procSetServiceStatus             = advapi32.NewProc("SetServiceStatus")
)

const (
	serviceWin32OwnProcess = 0x10

	serviceStopped      = 1
	serviceStartPending = 2
	serviceStopPending  = 3
	serviceRunning      = 4

	serviceAcceptStop     = 0x1
	serviceAcceptShutdown = 0x4

	controlStop        = 1
	controlInterrogate = 4
	controlShutdown    = 5

	errorFailedServiceControllerConnect = 1063
	errorServiceSpecificError           = 1066
	errorCallNotImplemented             = 120
)

type serviceStatus struct {
	ServiceType             uint32
	CurrentState            uint32
	ControlsAccepted        uint32
	Win32ExitCode           uint32
	ServiceSpecificExitCode uint32
	CheckPoint              uint32
	WaitHint                uint32
}

type serviceTableEntry struct {
	name *uint16
	proc uintptr
}

// One service per process, so package-level state is enough.
var svc struct {
	mu     sync.Mutex
	handle uintptr
	cancel context.CancelFunc
	fn     func(ctx context.Context) int
	code   int
}

func setStatus(state, accepts uint32, exitCode int) {
	st := serviceStatus{ServiceType: serviceWin32OwnProcess, CurrentState: state, ControlsAccepted: accepts}
	if exitCode != 0 {
		st.Win32ExitCode = errorServiceSpecificError
		st.ServiceSpecificExitCode = uint32(exitCode)
	}
	if state == serviceStartPending || state == serviceStopPending {
		st.WaitHint = 30_000
	}
	svc.mu.Lock()
	h := svc.handle
	svc.mu.Unlock()
	if h != 0 {
		procSetServiceStatus.Call(h, uintptr(unsafe.Pointer(&st)))
	}
}

// controlHandler is called by the service control manager on its own thread.
func controlHandler(control, _, _, _ uintptr) uintptr {
	switch control {
	case controlStop, controlShutdown:
		setStatus(serviceStopPending, 0, 0)
		svc.mu.Lock()
		if svc.cancel != nil {
			svc.cancel()
		}
		svc.mu.Unlock()
		return 0
	case controlInterrogate:
		return 0
	}
	return errorCallNotImplemented
}

// serviceMain runs on a thread the service control manager creates; it returns when the
// agent loop ends.
func serviceMain(_, _ uintptr) uintptr {
	if f := useLogFile(); f != nil {
		defer f.Close()
	}
	name, _ := syscall.UTF16PtrFromString(serviceName)
	h, _, _ := procRegisterServiceCtrlHandlerEx.Call(uintptr(unsafe.Pointer(name)), syscall.NewCallback(controlHandler), 0)
	if h == 0 {
		return 0
	}
	ctx, cancel := context.WithCancel(context.Background())
	svc.mu.Lock()
	svc.handle, svc.cancel = h, cancel
	svc.mu.Unlock()
	setStatus(serviceStartPending, 0, 0)
	setStatus(serviceRunning, serviceAcceptStop|serviceAcceptShutdown, 0)
	code := svc.fn(ctx)
	cancel()
	svc.code = code
	setStatus(serviceStopped, 0, code)
	return 0
}

// serve runs fn as the nf-agent Windows service when the service control manager started the
// process, and in the console (stopped with Ctrl+C) otherwise.
func serve(fn func(ctx context.Context) int) int {
	svc.fn = fn
	name, _ := syscall.UTF16PtrFromString(serviceName)
	table := []serviceTableEntry{{name: name, proc: syscall.NewCallback(serviceMain)}, {}}
	r, _, err := procStartServiceCtrlDispatcherW.Call(uintptr(unsafe.Pointer(&table[0])))
	if r != 0 {
		return svc.code // ran as a service; the dispatcher returns after it stopped
	}
	var errno syscall.Errno
	if !errors.As(err, &errno) || errno != errorFailedServiceControllerConnect {
		log.Printf("service dispatcher: %v", err)
		return 1
	}
	// Not started by the service control manager: run in the console.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	return fn(ctx)
}

// useLogFile sends the log to %ProgramData%\NeuralFrontier\agent.log (a service has no
// console), keeping one previous file once it passes 1 MB.
func useLogFile() *os.File {
	dir := filepath.Dir(defaultConfigPath)
	path := filepath.Join(dir, "agent.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 1<<20 {
		_ = os.Rename(path, path+".old")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil
	}
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.LUTC)
	return f
}
