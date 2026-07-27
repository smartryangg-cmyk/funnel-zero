//go:build windows

package main

import "syscall"

func hideConsoleWindow() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	user32 := syscall.NewLazyDLL("user32.dll")
	getConsoleWindow := kernel32.NewProc("GetConsoleWindow")
	showWindow := user32.NewProc("ShowWindow")
	window, _, _ := getConsoleWindow.Call()
	if window != 0 {
		const hide = 0
		_, _, _ = showWindow.Call(window, hide)
	}
}
