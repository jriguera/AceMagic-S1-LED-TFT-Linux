#!/usr/bin/env bash
# Network interface information script
# Usage: network-info.sh [prefix]
# Output: CSV with interface details (mac, ipv4, netmask, gateway, state)
# If no argument is provided, shows all interfaces
# If a prefix is provided, shows all interfaces starting with that prefix

PREFIX_FILTER="${1:-}"

# Function to get interface info
get_interface_info() {
    local INTERFACE="$1"
    
    # Get interface state
    STATE=$(cat "/sys/class/net/${INTERFACE}/operstate" 2>/dev/null || echo "unknown")

    # Get MAC address
    MAC=$(cat "/sys/class/net/${INTERFACE}/address" 2>/dev/null || echo "")

    # Get IPv4 address and netmask using ip command
    IPV4_INFO=$(ip -4 addr show "$INTERFACE" 2>/dev/null | grep -oP 'inet \K[\d.]+/\d+' | head -1)
    if [[ -n "$IPV4_INFO" ]]; then
        IPV4=$(echo "$IPV4_INFO" | cut -d'/' -f1)
        PREFIX=$(echo "$IPV4_INFO" | cut -d'/' -f2)
        # Convert prefix to netmask
        case $PREFIX in
            8)  NETMASK="255.0.0.0" ;;
            16) NETMASK="255.255.0.0" ;;
            24) NETMASK="255.255.255.0" ;;
            25) NETMASK="255.255.255.128" ;;
            26) NETMASK="255.255.255.192" ;;
            27) NETMASK="255.255.255.224" ;;
            28) NETMASK="255.255.255.240" ;;
            29) NETMASK="255.255.255.248" ;;
            30) NETMASK="255.255.255.252" ;;
            31) NETMASK="255.255.255.254" ;;
            32) NETMASK="255.255.255.255" ;;
            *)  NETMASK="/$PREFIX" ;;
        esac
    else
        IPV4=""
        NETMASK=""
        PREFIX=""
    fi

    # Get default gateway for this interface
    GATEWAY=$(ip route show dev "$INTERFACE" 2>/dev/null | grep -oP 'default via \K[\d.]+' | head -1)
    [[ -z "$GATEWAY" ]] && GATEWAY="-"

    # Get IPv6 address (first global address)
    IPV6=$(ip -6 addr show "$INTERFACE" scope global 2>/dev/null | grep -oP 'inet6 \K[0-9a-f:]+' | head -1)
    [[ -z "$IPV6" ]] && IPV6="-"

    # Get link speed (for physical interfaces)
    SPEED=$(cat "/sys/class/net/${INTERFACE}/speed" 2>/dev/null || echo "")
    if [[ -n "$SPEED" && "$SPEED" != "-1" ]]
    then
        if [[ "$SPEED" -ge 1000 ]]
        then
            SPEED_FMT="$((SPEED/1000))Gbps"
        else
            SPEED_FMT="${SPEED}Mbps"
        fi
    else
        SPEED_FMT="-"
    fi

    # Get MTU
    MTU=$(cat "/sys/class/net/${INTERFACE}/mtu" 2>/dev/null || echo "-")
    echo "${INTERFACE};${MAC};${IPV4};${PREFIX};${NETMASK};${GATEWAY};${IPV6};${STATE};${SPEED_FMT};${MTU}"
}

# Get list of interfaces matching the prefix (or all if no prefix)
if [[ -n "$PREFIX_FILTER" ]]
then
    INTERFACES=$(ls /sys/class/net/ 2>/dev/null | grep "^${PREFIX_FILTER}")
else
    INTERFACES=$(ls /sys/class/net/ 2>/dev/null)
fi

# Output CSV header
echo "interface;mac;ipv4;prefix;netmask;gateway;ipv6;state;speed;mtu"
# Output data for each interface
for iface in $INTERFACES
do
    get_interface_info "$iface"
done
