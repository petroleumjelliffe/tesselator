import { render } from 'preact';
import { App } from './components/App';
import { doc } from './state/doc';
import { exampleDoc } from './example';
import './styles.css';

if (new URLSearchParams(location.search).has('example')) doc.value = exampleDoc();
render(<App />, document.getElementById('root')!);
