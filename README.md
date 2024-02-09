# Kubectl Commands 

### Cluster & Node management:

Display endpoint information about the master and services in the cluster

```
kubectl cluster-info
```
Display the Kubernetes version running on the client and server

```
kubectl version
```
Get the configuration of the cluster

```
kubectl config view 
```
List the API resources that are available

```
kubectl api-resources
```
List the API versions that are available

```
kubectl api-versions
```

List everything

```
kubectl get all --all-namespaces 
```

### Markup

```html
<clipboard-copy for="blob-path" class="btn btn-sm BtnGroup-item">
  Copy path
</clipboard-copy>
<div id="blob-path">src/index.js</div>
```

## Data sources

### Attribute

```html
<clipboard-copy value="src/index.js">Copy</clipboard-copy>
```

### Element content

```html
<clipboard-copy for="blob-path">Copy</clipboard-copy>
<div id="blob-path">src/index.js</div>
```

### Form input

```html
<clipboard-copy for="blob-path">Copy</clipboard-copy>
<input id="blob-path" value="src/index.js">
```

### Hyperlink href

```html
<clipboard-copy for="blob-path">Copy full URL</clipboard-copy>
<a id="blob-path" href="/path/to#my-blob">Link text will not be copied</a>
```

## Events

After copying to the clipboard, a `clipboard-copy` event is dispatched from
the `<clipboard-copy>` element:

```js
document.addEventListener('clipboard-copy', function(event) {
  const button = event.target
  button.classList.add('highlight')
})
```

## Browser support

Browsers without native [custom element support][support] require a [polyfill][].

- Chrome
- Firefox
- Safari
- Microsoft Edge

[support]: https://caniuse.com/#feat=custom-elementsv1
[polyfill]: https://github.com/webcomponents/polyfills/tree/master/packages/custom-elements

## Development

```
npm install
npm test
```

## License

Distributed under the MIT license. See LICENSE for details.
