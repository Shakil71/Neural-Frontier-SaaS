package main

import "net"

// collectInterfaces lists the network interfaces that are up, without loopback.
func collectInterfaces() []Interface {
	out := []Interface{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagLoopback != 0 || ifc.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		list := []string{}
		for _, a := range addrs {
			if len(list) >= maxAddrs {
				break
			}
			list = append(list, clip(a.String(), 64))
		}
		out = append(out, Interface{Name: clip(ifc.Name, 64), MAC: ifc.HardwareAddr.String(), Addresses: list})
		if len(out) >= maxIfaces {
			break
		}
	}
	return out
}
