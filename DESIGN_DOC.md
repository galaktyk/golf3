create a vanilla js threejs project for visualize golf club orientation




## commutnication
both phone and server pc will be on the same local network




## Game server
### Network
game server use python fast api to host a threejs webpage and handle websocket connection for receiving orientation data from the player.

FastAPI server will serve two separate pages:

http://PC_IP:8000/game → visualizer (opens on PC browser)
http://PC_IP:8000/golf_club → player page (opens on phone browser)


### Visualizer
on the server pc, will open a webpage with threejs scene to visualize the golf club orientation.


(empty scene with grid helper and axis helper for now)
1.  the game server will receive the orientation data from the player and visualize it using threejs. 
(assets/models/golf_club.glb)




## Player part

1.  the golf club (phone for now) will open player page which use DeviceOrientationEvent  api to get the orientation of the phone and send it to the server via websocket 

-  neutral calibration  button to set the current phone pose as the neutral orientation, so that the player can swing the phone in a more natural way without worrying about the initial orientation.


- Orientation data will be sent at 60 Hz.
- The player page has a button to set the current phone pose as the neutral orientation.
- WebSocket payload format: binary packet containing 4 little-endian signed int16 quaternion components (x, y, z, w), normalized from [-32767, 32767] to [-1, 1] on decode. The viewer renormalizes the quaternion before applying it.
